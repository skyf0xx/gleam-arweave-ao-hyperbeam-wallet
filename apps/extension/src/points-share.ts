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
