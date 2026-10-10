import { SITE_URL } from "./site-pages";

export function inviteLinkFor(inviteCode: string): string {
  const url = new URL("invite.html", SITE_URL);
  url.searchParams.set("c", inviteCode);
  return url.toString();
}

export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

const TAGS = "@ArweaveEco @aoTheComputer";

/**
 * The post for the founding moment (POINTS.md § Share prompts). A part the
 * server hasn't reported is left out of the sentence rather than guessed.
 */
export function foundingPost(opts: { seats: number | null; link: string }): string {
  const invites = opts.seats !== null && opts.seats > 0 ? ` I have ${opts.seats} ${opts.seats === 1 ? "invite" : "invites"} if you want to get in early.` : "";
  return `Just got into @gleam_wallet, a new wallet for AO.${invites}\n${opts.link}\n${TAGS}`;
}

export function invitesLine(seats: number): string {
  if (seats <= 0) return "You have no invites left";
  return `You have ${seats} ${seats === 1 ? "invite" : "invites"}`;
}

/**
 * The always-available post (POINTS.md § Share prompts, "Any time"). A part
 * the server hasn't reported is left out of the sentence rather than guessed.
 */
export function invitePost(opts: { seats: number | null; link: string }): string {
  const invites = opts.seats !== null && opts.seats > 0 ? ` I have ${opts.seats} ${opts.seats === 1 ? "invite" : "invites"} if you want to get in early.` : "";
  return `Just joined @gleam_wallet, a new wallet for AO.${invites}\n${opts.link}\n${TAGS}`;
}

/** The post for a seat that came back (POINTS.md § Share prompts, "Gains a seat"). */
export function gainedSeatPost(opts: { link: string }): string {
  return `Someone I invited just joined @gleam_wallet, so I got another invite. Who wants it?\n${opts.link}\n${TAGS}`;
}

/**
 * The post for the last seat. It carries no link on purpose: replies to a
 * giveaway spread further than a link the first clicker takes.
 */
export function lastSeatPost(): string {
  return `I've got one @gleam_wallet invite left. Reply if you want it and I'll send it over.\n${TAGS}`;
}
