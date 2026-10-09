/** A wallet's Gleam Points registration, as the extension stores it. */
export interface PointsMembership {
  address: string;
  /** The wallet's own code, for its invite link. */
  inviteCode: string;
  /** Whether the server credited this wallet as invited. */
  referred: boolean;
  joinedAt: number;
}

/** One wallet's standing, as the points API's `POST /me` reports it. */
export interface PointsWalletScore {
  address: string;
  inviteCode: string;
  referred: boolean;
  refereeCount: number;
  totalAtomic: string;
  lastDay: { holdingAtomic: string; refereeBonusAtomic: string; founderBonusAtomic: string; referrerBonusAtomic: string } | null;
  /** "Top N%" among wallets with points; null until the wallet has some. */
  topPercent: number | null;
  /** Null for wallets that registered after Phase 1. */
  foundingNumber: number | null;
  /** Backfilled before Phase 1: gets the referee bonus without a code. */
  originalFounder: boolean;
}

export interface PointsScores {
  /** When the latest daily snapshot completed (ISO 8601); null before the first. */
  settledAt: string | null;
  wallets: PointsWalletScore[];
}
