import type { Queryable } from "./db";
import { MEMBER_SEAT_BALANCE_SQL, memberSeatsLeft } from "./invite";

export interface WalletScore {
  address: string;
  inviteCode: string;
  referred: boolean;
  refereeCount: number;
  /** Holding, referral and scan points together. */
  totalAtomic: string;
  /** Points from scans and accepted findings, already in `totalAtomic`. */
  scanPointsAtomic: string;
  /** The latest snapshot's credit, which the extension projects forward from. */
  lastDay: { holdingAtomic: string; refereeBonusAtomic: string; founderBonusAtomic: string; referrerBonusAtomic: string } | null;
  /** "Top N%" among wallets with any points; null until the wallet has some. */
  topPercent: number | null;
  /** 1-based place among wallets with points, ties sharing a place; null until the wallet has some. Private: never listed. */
  rank: number | null;
  /** Atomic points that would put the wallet strictly above the next wallet up; null for the leader or an unranked wallet. */
  pointsToNextRankAtomic: string | null;
  /** Null for wallets that registered after Phase 1. */
  foundingNumber: number | null;
  /** Backfilled before Phase 1: gets the referee bonus without a code. */
  originalFounder: boolean;
  /** Installs the wallet's code can still let in; null when seats aren't limited (Phase 2). */
  seatsLeft: number | null;
}

export interface DeviceScores {
  /** When the latest daily snapshot completed; null before the first one. */
  settledAt: string | null;
  wallets: WalletScore[];
}

/**
 * Totals are recomputed from `points` on each read. That's a scan over
 * every credited day; once it shows up in latency, keep running totals in
 * a table the snapshot updates.
 */
export async function scoresForDevice(db: Queryable, deviceId: string, pointsPhase: 1 | 2): Promise<DeviceScores> {
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
    })),
  };
}

/** Rounded up and never 0, so the leader reads "Top 1%" rather than "Top 0%". */
function topPercent(rank: number, ranked: number): number {
  return Math.max(1, Math.ceil((rank / ranked) * 100));
}
