export const SITE_URL = "https://gleam-wallet.vercel.app/";

export type SitePage = "welcome" | "feedback" | "goodbye";

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
