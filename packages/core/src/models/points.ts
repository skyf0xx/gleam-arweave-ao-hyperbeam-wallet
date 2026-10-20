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
  /** Scan and finding points, already in `totalAtomic`. Absent from servers that predate community scans. */
  scanPointsAtomic?: string;
  lastDay: { holdingAtomic: string; refereeBonusAtomic: string; founderBonusAtomic: string; referrerBonusAtomic: string } | null;
  /** "Top N%" among wallets with points; null until the wallet has some. */
  topPercent: number | null;
  /** 1-based place among wallets with points, ties sharing a place; null until the wallet has some. Never shown as a list. */
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

/**
 * The error message `join` throws when the server refuses a Phase 1
 * registration for lack of an invite. The popup matches on it to open the
 * invite gate, since errors cross the messaging boundary as plain messages.
 */
export const INVITE_REQUIRED_MESSAGE = "An invite is required to join Gleam Points.";

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
