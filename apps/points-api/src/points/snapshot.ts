import { mapLimit } from "@gleam/core/src/ao/asset-scan.ts";
import { computeDailyPoints, type WalletSnapshot } from "@gleam/core/src/points/index.ts";
import type { BalanceReader } from "./balances";
import type { Db } from "../db";
import { errorMessage } from "@gleam/core/src/models/error-message.ts";

export const LIVENESS_WINDOW_MS = 3 * 86_400_000;
/** Percent of a day's holding points that joins the bounty pool (SCANS.md § Points). */
export const POOL_GROWTH_PERCENT = 2;

export interface SnapshotOptions {
  readBalances: BalanceReader;
  concurrency?: number;
  attempts?: number;
  /** First retry's delay; each later one doubles it. */
  retryDelayMs?: number;
  log?: (line: string) => void;
}

export interface SnapshotSummary {
  day: string;
  walletCount: number;
  liveCount: number;
  failedCount: number;
}

/**
 * Takes today's (UTC) snapshot and credits its points, or returns null if
 * today already has one. A live wallet whose balance reads keep failing
 * is credited from the last balance read while it was live, so a bad
 * spell at the gateway doesn't cost it the day; one with no earlier read
 * is left out. Both count in `snapshot_runs.failed_count`.
 *
 * Balance reads take minutes, so a wallet can leave mid-run; the inserts
 * skip any address no longer in `wallets`.
 *
 * Callers serialize runs with `Db.withLock`; inserting the
 * `snapshot_runs` row first also makes a racing duplicate fail its
 * transaction instead of crediting a day twice.
 */
export async function runSnapshot(db: Db, now: Date, options: SnapshotOptions): Promise<SnapshotSummary | null> {
  const day = now.toISOString().slice(0, 10);
  const done = await db.query("SELECT 1 FROM snapshot_runs WHERE day = $1", [day]);
  if (done.rows.length > 0) return null;

  const { rows: wallets } = await db.query<{ address: string; device_id: string; referred_by: string | null; original_founder: boolean; live: boolean }>(
    `SELECT w.address, w.device_id, w.referred_by, w.original_founder,
            EXISTS (SELECT 1 FROM wallet_devices wd JOIN devices d ON d.id = wd.device_id
                    WHERE wd.address = w.address AND d.last_heartbeat_at >= $1) AS live
       FROM wallets w`,
    [new Date(now.getTime() - LIVENESS_WINDOW_MS)],
  );

  const lastRead = await lastLiveBalances(db, day);
  const log = options.log ?? console.log;
  const snapshots: WalletSnapshot[] = [];
  let failedCount = 0;
  await mapLimit(wallets, options.concurrency ?? 8, async (wallet) => {
    if (!wallet.live) {
      snapshots.push({ address: wallet.address, deviceId: wallet.device_id, arAtomic: "0", aoAtomic: "0", live: false, referredBy: wallet.referred_by, originalFounder: wallet.original_founder });
      return;
    }
    const read = await withRetries(() => options.readBalances(wallet.address), options);
    const balances = read.ok ? read.value : lastRead.get(wallet.address);
    if (!read.ok) {
      failedCount += 1;
      log(`Snapshot ${day}: balance read for ${wallet.address} failed (${read.error}); ${balances ? "using its last read" : "left out"}`);
    }
    if (!balances) return;
    snapshots.push({ address: wallet.address, deviceId: wallet.device_id, ...balances, live: true, referredBy: wallet.referred_by, originalFounder: wallet.original_founder });
  });

  const points = computeDailyPoints(snapshots);

  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO snapshot_runs (day, completed_at, wallet_count, failed_count) VALUES ($1, $2, $3, $4)",
      [day, now, wallets.length, failedCount],
    );
    await tx.query(
      `INSERT INTO snapshots (day, address, ar_atomic, ao_atomic, live)
       SELECT $1::date, s.* FROM unnest($2::text[], $3::numeric[], $4::numeric[], $5::boolean[])
         AS s (address, ar, ao, live)
        WHERE EXISTS (SELECT 1 FROM wallets w WHERE w.address = s.address)`,
      [
        day,
        snapshots.map((s) => s.address),
        snapshots.map((s) => s.arAtomic),
        snapshots.map((s) => s.aoAtomic),
        snapshots.map((s) => s.live),
      ],
    );
    const credited = [...points].filter(([, p]) => p.totalAtomic !== "0");
    await tx.query(
      `INSERT INTO points (day, address, holding_atomic, referee_bonus_atomic, founder_bonus_atomic, referrer_bonus_atomic)
       SELECT $1::date, p.* FROM unnest($2::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[])
         AS p (address, holding, referee, founder, referrer)
        WHERE EXISTS (SELECT 1 FROM wallets w WHERE w.address = p.address)`,
      [
        day,
        credited.map(([address]) => address),
        credited.map(([, p]) => p.holdingAtomic),
        credited.map(([, p]) => p.refereeBonusAtomic),
        credited.map(([, p]) => p.founderBonusAtomic),
        credited.map(([, p]) => p.referrerBonusAtomic),
      ],
    );
    // Summed from the stored rows so it matches what members were credited,
    // wallets that left mid-run excluded.
    await tx.query(
      `INSERT INTO bounty_pool (day, delta_atomic, reason, created_at)
       SELECT $1::date, div(t.total * $2, 100), 'daily', $3
         FROM (SELECT coalesce(sum(holding_atomic), 0) AS total FROM points WHERE day = $1::date) t
        WHERE div(t.total * $2, 100) > 0`,
      [day, POOL_GROWTH_PERCENT, now],
    );
  });

  return {
    day,
    walletCount: wallets.length,
    liveCount: snapshots.filter((s) => s.live).length,
    failedCount,
  };
}

async function lastLiveBalances(db: Db, day: string): Promise<Map<string, { arAtomic: string; aoAtomic: string }>> {
  const { rows } = await db.query<{ address: string; ar: string; ao: string }>(
    `SELECT DISTINCT ON (address) address, ar_atomic::text AS ar, ao_atomic::text AS ao
       FROM snapshots WHERE day < $1::date AND live ORDER BY address, day DESC`,
    [day],
  );
  return new Map(rows.map((row) => [row.address, { arAtomic: row.ar, aoAtomic: row.ao }]));
}

/** Defaults wait 5, 10, 20 and 40 seconds, outlasting a gateway's short bad spell. */
async function withRetries<T>(
  read: () => Promise<T>,
  options: Pick<SnapshotOptions, "attempts" | "retryDelayMs">,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const attempts = options.attempts ?? 5;
  let error = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { ok: true, value: await read() };
    } catch (caught) {
      error = errorMessage(caught);
      if (attempt < attempts) await sleep((options.retryDelayMs ?? 5_000) * 2 ** (attempt - 1));
    }
  }
  return { ok: false, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
