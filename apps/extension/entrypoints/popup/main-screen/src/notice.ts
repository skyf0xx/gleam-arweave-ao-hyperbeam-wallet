import type { Announcement } from "@gleam/core";

export type Notice = { kind: "invites" } | { kind: "announcement"; announcement: Announcement };

export interface NoticeState {
  /** The active wallet's seat count from `/me`; null when it has no seat limit or isn't loaded. */
  seatsLeft: number | null;
  /** The count the member was last shown; undefined if never recorded. */
  seatsSeen: number | undefined;
  announcements: readonly Announcement[];
  dismissed: readonly string[];
}

/**
 * The one notice to show. New invites come first: they are personal and
 * time-bound. Otherwise the first announcement not yet dismissed.
 */
export function pickNotice({ seatsLeft, seatsSeen, announcements, dismissed }: NoticeState): Notice | null {
  if (seatsLeft !== null && seatsSeen !== undefined && seatsLeft > seatsSeen) return { kind: "invites" };
  const announcement = announcements.find((candidate) => !dismissed.includes(candidate.id));
  return announcement ? { kind: "announcement", announcement } : null;
}
