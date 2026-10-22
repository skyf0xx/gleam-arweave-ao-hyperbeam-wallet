import type { Announcement, ReviewMoment } from "@gleam/core";

export type Notice =
  | { kind: "invites" }
  | { kind: "review"; moment: ReviewMoment }
  | { kind: "announcement"; announcement: Announcement };

export interface NoticeState {
  /** The active wallet's seat count from `/me`; null when it has no seat limit or isn't loaded. */
  seatsLeft: number | null;
  /** The count the member was last shown; undefined if never recorded. */
  seatsSeen: number | undefined;
  announcements: readonly Announcement[];
  dismissed: readonly string[];
  /** The moment to ask for a store review after; null when there's none or it was asked. */
  review: ReviewMoment | null;
}

/**
 * The one notice to show. New invites come first: they are personal and
 * time-bound. A critical announcement outranks the review prompt, which
 * outranks an info one, so a standing welcome notice can't hold the
 * prompt back until its moment has passed.
 */
export function pickNotice({ seatsLeft, seatsSeen, announcements, dismissed, review }: NoticeState): Notice | null {
  if (seatsLeft !== null && seatsSeen !== undefined && seatsLeft > seatsSeen) return { kind: "invites" };
  const open = announcements.filter((candidate) => !dismissed.includes(candidate.id));
  const critical = open.find((candidate) => candidate.level === "critical");
  if (critical) return { kind: "announcement", announcement: critical };
  if (review) return { kind: "review", moment: review };
  const announcement = open[0];
  return announcement ? { kind: "announcement", announcement } : null;
}
