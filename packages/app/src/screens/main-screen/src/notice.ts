import type { Announcement, PointsMembership, PointsScores, ReviewMoment } from "@gleam/core";

/** A member wallet whose seat count rose above the count it was last shown. */
export interface NewInvites {
  walletId: string;
  address: string;
  seatsLeft: number;
}

export type Notice =
  | { kind: "invites"; invites: NewInvites }
  | { kind: "review"; moment: ReviewMoment }
  | { kind: "announcement"; announcement: Announcement }
  | { kind: "update"; version: string };

/** Dismissed with the announcements, keyed by version so the next release notifies again. */
export function updateNoticeId(version: string): string {
  return `update-${version}`;
}

/**
 * The wallet whose new invites to show, the active one first. Any member
 * wallet counts, because the toolbar dot lights for any of them and the
 * notice is where it gets cleared.
 */
export function findNewInvites(
  activeWalletId: string,
  memberships: Record<string, PointsMembership>,
  scores: PointsScores | null | undefined,
  seatsSeen: Record<string, number> | undefined,
): NewInvites | null {
  const found = Object.entries(memberships).flatMap(([walletId, { address }]) => {
    const seatsLeft = scores?.wallets.find((wallet) => wallet.address === address)?.seatsLeft;
    const seen = seatsSeen?.[walletId];
    return typeof seatsLeft === "number" && seen !== undefined && seatsLeft > seen ? [{ walletId, address, seatsLeft }] : [];
  });
  return found.find((invites) => invites.walletId === activeWalletId) ?? found[0] ?? null;
}

export interface NoticeState {
  invites: NewInvites | null;
  announcements: readonly Announcement[];
  dismissed: readonly string[];
  /** The moment to ask for a store review after; null when there's none or it was asked. */
  review: ReviewMoment | null;
  /** A newer release for a shell that doesn't update itself; null or absent when there's none. */
  update?: string | null;
}

/**
 * The one notice to show. New invites come first: they are personal and
 * time-bound. A critical announcement outranks an update, which outranks
 * the review prompt, which outranks an info one, so a standing welcome notice can't hold the
 * prompt back until its moment has passed.
 */
export function pickNotice({ invites, announcements, dismissed, review, update = null }: NoticeState): Notice | null {
  if (invites) return { kind: "invites", invites };
  const open = announcements.filter((candidate) => !dismissed.includes(candidate.id));
  const critical = open.find((candidate) => candidate.level === "critical");
  if (critical) return { kind: "announcement", announcement: critical };
  if (update !== null && !dismissed.includes(updateNoticeId(update))) return { kind: "update", version: update };
  if (review) return { kind: "review", moment: review };
  const announcement = open[0];
  return announcement ? { kind: "announcement", announcement } : null;
}
