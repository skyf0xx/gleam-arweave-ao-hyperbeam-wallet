import { SITE_URL } from "./site-pages";

export function inviteLinkFor(inviteCode: string): string {
  const url = new URL("invite.html", SITE_URL);
  url.searchParams.set("c", inviteCode);
  return url.toString();
}

export function invitesLine(seats: number): string {
  if (seats <= 0) return "All your invites are used";
  return `You have ${seats} ${seats === 1 ? "invite" : "invites"}`;
}

/** The Points screen's count, where "remaining" fits because seats run down as friends use them. */
export function invitesRemainingLine(seats: number): string {
  if (seats <= 0) return "All your invites are used";
  return `${seats} ${seats === 1 ? "invite" : "invites"} remaining`;
}
