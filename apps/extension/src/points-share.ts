import { SITE_URL } from "./site-pages";

export function inviteLinkFor(inviteCode: string): string {
  const url = new URL("invite.html", SITE_URL);
  url.searchParams.set("c", inviteCode);
  return url.toString();
}

export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/**
 * The post for the founding moment (POINTS.md § Share prompts). A part the
 * server hasn't reported is left out of the sentence rather than guessed.
 */
export function foundingPost(opts: { foundingNumber: number | null; seats: number | null; link: string }): string {
  const parts = ["Just got into @gleam_wallet, the new wallet for AO."];
  if (opts.foundingNumber !== null) {
    const invites = opts.seats !== null && opts.seats > 0 ? ` and I have ${opts.seats} ${opts.seats === 1 ? "invite" : "invites"}` : "";
    parts.push(`I'm Founding #${opts.foundingNumber}${invites}.`);
  }
  parts.push(opts.link);
  return parts.join(" ");
}

export function invitesLine(seats: number): string {
  if (seats <= 0) return "You have no invites left";
  return `You have ${seats} ${seats === 1 ? "invite" : "invites"}`;
}

/**
 * The always-available post (POINTS.md § Share prompts, "Any time"). A part
 * the server hasn't reported is left out of the sentence rather than guessed.
 */
export function invitePost(opts: { foundingNumber: number | null; seats: number | null; link: string }): string {
  const lead = opts.foundingNumber !== null ? `I'm Founding Gleam #${opts.foundingNumber}. Early` : "Early";
  const hasSeats = opts.seats !== null && opts.seats > 0;
  const invites = hasSeats ? ` I have ${opts.seats} ${opts.seats === 1 ? "invite" : "invites"}:` : "";
  return `${lead} to a new wallet for AO.${invites} ${opts.link}`;
}
