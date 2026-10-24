import { SITE_URL } from "./site-origin";

export const REPO_URL = "https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet";

/** The Chrome Web Store reviews tab, where the review prompt sends people. */
export const STORE_REVIEWS_URL = "https://chromewebstore.google.com/detail/einabcphdmlicabnjllaaallnebfkmki/reviews";

export function releaseUrl(version: string): string {
  return `${REPO_URL}/releases/tag/v${version}`;
}

export type SitePage = "welcome" | "feedback" | "goodbye" | "gleam" | "points" | "scan" | "review-results";

/**
 * A page on the Gleam website. The extension version is the only thing
 * these links ever carry: the pages use it to label feedback and to
 * count installs, so nothing about the user or their wallet may go here.
 */
export function sitePageUrl(page: SitePage, version: string): string {
  const url = new URL(`${page}.html`, SITE_URL);
  url.searchParams.set("v", version);
  return url.toString();
}
