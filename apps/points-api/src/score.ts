import type { Queryable } from "./db";
import { memberSeatsLeft, PENDING_MEMBER_REDEMPTIONS_SQL } from "./invite";

export interface WalletScore {
  address: string;
  inviteCode: string;
  referred: boolean;
  refereeCount: number;
  totalAtomic: string;
  /** The latest snapshot's credit, which the extension projects forward from. */
  lastDay: { holdingAtomic: string; refereeBonusAtomic: string; founderBonusAtomic: string; referrerBonusAtomic: string } | null;
  /** "Top N%" among wallets with any points; null until the wallet has some. */
  topPercent: number | null;
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
    rank: string | null;
    founding_number: number | null;
    original_founder: boolean;
    pending_redemptions: string;
    ranked: string;
    holding: string | null;
    referee_bonus: string | null;
    founder_bonus: string | null;
    referrer_bonus: string | null;
  }>(
    `WITH totals AS (
       SELECT address, sum(holding_atomic + referee_bonus_atomic + founder_bonus_atomic + referrer_bonus_atomic) AS total
         FROM points GROUP BY address
     ),
     ranked AS (
       SELECT address, total, rank() OVER (ORDER BY total DESC) AS rank, count(*) OVER () AS ranked
         FROM totals WHERE total > 0
     )
     SELECT w.address, w.invite_code, w.referred_by IS NOT NULL AS referred, w.founding_number, w.original_founder,
            (SELECT count(*) FROM wallets r WHERE r.referred_by = w.address)::text AS referee_count,
            ${PENDING_MEMBER_REDEMPTIONS_SQL}::text AS pending_redemptions,
            r.total::text AS total, r.rank::text AS rank,
            coalesce((SELECT count(*) FROM ranked), 0)::text AS ranked,
            p.holding_atomic::text AS holding, p.referee_bonus_atomic::text AS referee_bonus,
            p.founder_bonus_atomic::text AS founder_bonus,
            p.referrer_bonus_atomic::text AS referrer_bonus
       FROM wallets w
       LEFT JOIN ranked r ON r.address = w.address
       LEFT JOIN points p ON p.address = w.address AND p.day = $2::date
      WHERE w.device_id = $1
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
      seatsLeft: memberSeatsLeft(Number(row.pending_redemptions), pointsPhase),
      topPercent: row.rank === null ? null : topPercent(Number(row.rank), Number(row.ranked)),
    })),
  };
}

/** Rounded up and never 0, so the leader reads "Top 1%" rather than "Top 0%". */
function topPercent(rank: number, ranked: number): number {
  return Math.max(1, Math.ceil((rank / ranked) * 100));
}
