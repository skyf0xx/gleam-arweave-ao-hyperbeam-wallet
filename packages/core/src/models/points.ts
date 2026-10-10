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
  /** Installs the wallet's code can still let in; null when seats aren't limited (Phase 2). */
  seatsLeft: number | null;
}

export interface PointsScores {
  /** When the latest daily snapshot completed (ISO 8601); null before the first. */
  settledAt: string | null;
  wallets: PointsWalletScore[];
}

/**
 * What the points API said about an install's invite code. `offline` means
 * the request didn't get an answer (network, rate limit, server error), so
 * it can be tried again; the other three are the server's verdict.
 */
export type InviteRedeemResult = "ok" | "full" | "unknown" | "offline";

/** An install's install-time redemption, as the extension stores it. */
export interface InviteUnlock {
  code: string;
  result: InviteRedeemResult;
  at: number;
}

/**
 * The one-time share prompts that are keyed by name. The "gains a seat"
 * prompt is keyed by the seat count instead (see `PointsSeatsSeen`).
 */
export type PointsSharePrompt = "joined" | "lastSeat";

/** What the extension remembers about one wallet's seat count. */
export interface PointsSeatsRecord {
  /** The count the member has been shown; a higher count is a new invite. */
  seen: number;
  /** The newest count the points API reported. */
  latest: number;
}
