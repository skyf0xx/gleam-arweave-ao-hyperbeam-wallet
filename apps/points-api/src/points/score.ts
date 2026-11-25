import type { PointsRecentEntry, PointsScores, PointsWalletScore } from "@gleam/core/src/models/points.ts";
import type { Queryable } from "../db";
import { MEMBER_SEAT_BALANCE_SQL, memberSeatsLeft } from "../wallets/invite";

/** The wire shape with the fields older servers lacked always sent. */
export type WalletScore = Required<PointsWalletScore>;

/** Covers the start of "yesterday" in any time zone, so the client can group by its own day. */
export const RECENT_WINDOW_MS = 2 * 86_400_000;

export interface DeviceScores extends PointsScores {
  wallets: WalletScore[];
}

/**
 * Totals are recomputed from `points` on each read. That's a scan over
 * every credited day; once it shows up in latency, keep running totals in
 * a table the snapshot updates.
 */
export async function scoresForDevice(db: Queryable, deviceId: string, pointsPhase: 1 | 2, now: Date): Promise<DeviceScores> {
  const latest = await db.query<{ day: string; completed_at: Date }>(
    "SELECT day::text AS day, completed_at FROM snapshot_runs ORDER BY day DESC LIMIT 1",
  );
  const latestDay = latest.rows[0]?.day ?? null;

  const { rows } = await db.query<{
    address: string;
    invite_code: string;
    referred: boolean;
    referee_count: string;
    total: string | null;
    scan_points: string;
    rank: string | null;
    to_next: string | null;
    founding_number: number | null;
    original_founder: boolean;
    seat_balance: string;
    ranked: string;
    holding: string | null;
    referee_bonus: string | null;
    founder_bonus: string | null;
    referrer_bonus: string | null;
  }>(
    `WITH totals AS (
       SELECT address, sum(amount) AS total FROM (
         SELECT address, holding_atomic + referee_bonus_atomic + founder_bonus_atomic + referrer_bonus_atomic AS amount FROM points
         UNION ALL
         SELECT address, amount_atomic FROM scan_points
       ) credits GROUP BY address
     ),
     ranked AS (
       SELECT address, total, rank() OVER (ORDER BY total DESC) AS rank, count(*) OVER () AS ranked
         FROM totals WHERE total > 0
     )
     SELECT w.address, w.invite_code, w.referred_by IS NOT NULL AS referred, w.founding_number, w.original_founder,
            (SELECT count(*) FROM wallets r WHERE r.referred_by = w.address)::text AS referee_count,
            ${MEMBER_SEAT_BALANCE_SQL}::text AS seat_balance,
            r.total::text AS total,
            (SELECT coalesce(sum(s.amount_atomic), 0) FROM scan_points s WHERE s.address = w.address)::text AS scan_points,
            r.rank::text AS rank,
            (SELECT min(a.total) - r.total + 1 FROM ranked a WHERE a.total > r.total)::text AS to_next,
            coalesce((SELECT count(*) FROM ranked), 0)::text AS ranked,
            p.holding_atomic::text AS holding, p.referee_bonus_atomic::text AS referee_bonus,
            p.founder_bonus_atomic::text AS founder_bonus,
            p.referrer_bonus_atomic::text AS referrer_bonus
       FROM wallets w
       LEFT JOIN ranked r ON r.address = w.address
       LEFT JOIN points p ON p.address = w.address AND p.day = $2::date
      WHERE EXISTS (SELECT 1 FROM wallet_devices wd WHERE wd.address = w.address AND wd.device_id = $1)
      ORDER BY w.registered_at, w.address`,
    [deviceId, latestDay],
  );

  const recent = await recentForWallets(db, rows.map((row) => row.address), new Date(now.getTime() - RECENT_WINDOW_MS));

  return {
    settledAt: latest.rows[0]?.completed_at.toISOString() ?? null,
    wallets: rows.map((row) => ({
      address: row.address,
      inviteCode: row.invite_code,
      referred: row.referred,
      refereeCount: Number(row.referee_count),
      totalAtomic: row.total ?? "0",
      scanPointsAtomic: row.scan_points,
      lastDay:
        row.holding === null
          ? null
          : {
              holdingAtomic: row.holding,
              refereeBonusAtomic: row.referee_bonus!,
              founderBonusAtomic: row.founder_bonus!,
              referrerBonusAtomic: row.referrer_bonus!,
            },
      foundingNumber: row.founding_number,
      originalFounder: row.original_founder,
      seatsLeft: memberSeatsLeft(Number(row.seat_balance), pointsPhase),
      rank: row.rank === null ? null : Number(row.rank),
      pointsToNextRankAtomic: row.to_next,
      topPercent: row.rank === null ? null : topPercent(Number(row.rank), Number(row.ranked)),
      recent: recent.get(row.address) ?? [],
    })),
  };
}

async function recentForWallets(db: Queryable, addresses: string[], since: Date): Promise<Map<string, PointsRecentEntry[]>> {
  const byAddress = new Map<string, PointsRecentEntry[]>(addresses.map((address) => [address, []]));
  if (addresses.length === 0) return byAddress;

  const [daily, scans, friends] = await Promise.all([
    db.query<{ address: string; at: Date; holding: string; referee_bonus: string; founder_bonus: string; referrer_bonus: string }>(
      `SELECT p.address, r.completed_at AS at, p.holding_atomic::text AS holding, p.referee_bonus_atomic::text AS referee_bonus,
              p.founder_bonus_atomic::text AS founder_bonus, p.referrer_bonus_atomic::text AS referrer_bonus
         FROM points p JOIN snapshot_runs r ON r.day = p.day
        WHERE p.address = ANY($1) AND r.completed_at >= $2`,
      [addresses, since],
    ),
    db.query<{ address: string; at: Date; kind: "scan" | "finding"; amount: string; release: string; ref: string | null }>(
      `SELECT s.address, s.created_at AS at, s.kind, s.amount_atomic::text AS amount, a.release, s.ref
         FROM scan_points s JOIN attestations a ON a.id = s.attestation_id
        WHERE s.address = ANY($1) AND s.created_at >= $2 AND s.amount_atomic > 0`,
      [addresses, since],
    ),
    db.query<{ address: string; at: Date }>(
      "SELECT referred_by AS address, registered_at AS at FROM wallets WHERE referred_by = ANY($1) AND registered_at >= $2",
      [addresses, since],
    ),
  ]);

  const push = (address: string, entry: PointsRecentEntry) => byAddress.get(address)?.push(entry);
  for (const row of daily.rows) {
    const at = row.at.toISOString();
    const parts = [
      ["holding", row.holding],
      ["invited", row.referee_bonus],
      ["founder", row.founder_bonus],
      ["invites", row.referrer_bonus],
    ] as const;
    for (const [kind, amountAtomic] of parts) {
      if (BigInt(amountAtomic) > 0n) push(row.address, { kind, amountAtomic, at });
    }
  }
  for (const row of scans.rows) {
    const at = row.at.toISOString();
    push(
      row.address,
      row.kind === "scan"
        ? { kind: "scan", amountAtomic: row.amount, at, release: row.release }
        : { kind: "finding", amountAtomic: row.amount, at, release: row.release, ref: row.ref },
    );
  }
  for (const row of friends.rows) push(row.address, { kind: "friendJoined", at: row.at.toISOString() });

  for (const entries of byAddress.values()) entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return byAddress;
}

/** Rounded up and never 0, so the leader reads "Top 1%" rather than "Top 0%". */
function topPercent(rank: number, ranked: number): number {
  return Math.max(1, Math.ceil((rank / ranked) * 100));
}
