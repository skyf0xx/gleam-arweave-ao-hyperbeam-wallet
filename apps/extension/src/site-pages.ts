export const SITE_URL = "https://gleamwallet.app/";

/** The only origin `externally_connectable` lets message a production build. */
export const SITE_ORIGIN = new URL(SITE_URL).origin;

/**
 * Hosts a development build also takes site messages from, on any port,
 * so a local copy of the site (`attest.html`) can be tested before it
 * deploys. `wxt.config.ts` adds them to `externally_connectable` only in
 * development mode, and `dispatch/site.ts`'s `isSiteOrigin` accepts them
 * only in a development bundle.
 */
export const DEV_SITE_HOSTS: readonly string[] = ["localhost", "127.0.0.1"];

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

export interface SitePagesDeps {
  version: string;
  openTab: (url: string) => Promise<unknown>;
  setUninstallUrl: (url: string) => Promise<void>;
}

/**
 * Runs on `runtime.onInstalled`. The uninstall URL is set on updates too,
 * so it always carries the current version; the welcome page opens only
 * on a first install.
 */
export async function handleInstalledSitePages(reason: string, deps: SitePagesDeps): Promise<void> {
  await deps.setUninstallUrl(sitePageUrl("goodbye", deps.version));
  if (reason === "install") {
    await deps.openTab(sitePageUrl("welcome", deps.version));
  }
}
