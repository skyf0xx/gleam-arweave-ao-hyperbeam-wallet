/** A wallet's Gleam Points registration, as the extension stores it. */
export interface PointsMembership {
  address: string;
  /** The wallet's own code, for its invite link. */
  inviteCode: string;
  /** Whether the server credited this wallet as invited. */
  referred: boolean;
  joinedAt: number;
}
