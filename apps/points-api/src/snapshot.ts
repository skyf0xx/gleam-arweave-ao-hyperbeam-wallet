import { computeDailyPoints, type WalletSnapshot } from "@gleam/core/src/points/index.ts";
import type { BalanceReader } from "./balances";
import type { Db } from "./db";

export const LIVENESS_WINDOW_MS = 3 * 86_400_000;

export interface SnapshotOptions {
  readBalances: BalanceReader;
  concurrency?: number;
  attempts?: number;
  retryDelayMs?: number;
}

export interface SnapshotSummary {
  day: string;
  walletCount: number;
  liveCount: number;
  failedCount: number;
}

/**
 * Takes today's (UTC) snapshot and credits its points, or returns null if
 * today already has one. Wallets whose balance reads keep failing are
 * left out of the day and counted in `snapshot_runs.failed_count`.
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

  const { rows: wallets } = await db.query<{ address: string; referred_by: string | null; live: boolean }>(
    `SELECT w.address, w.referred_by,
            coalesce(d.last_heartbeat_at >= $1, false) AS live
       FROM wallets w JOIN devices d ON d.id = w.device_id`,
    [new Date(now.getTime() - LIVENESS_WINDOW_MS)],
  );

  const snapshots: WalletSnapshot[] = [];
  let failedCount = 0;
  await forEachWithConcurrency(wallets, options.concurrency ?? 8, async (wallet) => {
    if (!wallet.live) {
      snapshots.push({ address: wallet.address, arAtomic: "0", aoAtomic: "0", live: false, referredBy: wallet.referred_by });
      return;
    }
    const balances = await withRetries(() => options.readBalances(wallet.address), options);
    if (!balances) {
      failedCount += 1;
      return;
    }
    snapshots.push({ address: wallet.address, ...balances, live: true, referredBy: wallet.referred_by });
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
      `INSERT INTO points (day, address, holding_atomic, referee_bonus_atomic, referrer_bonus_atomic)
       SELECT $1::date, p.* FROM unnest($2::text[], $3::numeric[], $4::numeric[], $5::numeric[])
         AS p (address, holding, referee, referrer)
        WHERE EXISTS (SELECT 1 FROM wallets w WHERE w.address = p.address)`,
      [
        day,
        credited.map(([address]) => address),
        credited.map(([, p]) => p.holdingAtomic),
        credited.map(([, p]) => p.refereeBonusAtomic),
        credited.map(([, p]) => p.referrerBonusAtomic),
      ],
    );
  });

  return {
    day,
    walletCount: wallets.length,
    liveCount: snapshots.filter((s) => s.live).length,
    failedCount,
  };
}

async function withRetries<T>(
  read: () => Promise<T>,
  options: Pick<SnapshotOptions, "attempts" | "retryDelayMs">,
): Promise<T | null> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await read();
    } catch {
      if (attempt < attempts) await sleep((options.retryDelayMs ?? 2_000) * attempt);
    }
  }
  return null;
}

async function forEachWithConcurrency<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
