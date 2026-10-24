import { sitePageUrl } from "@gleam/core/src/models/site-links.ts";

export { SITE_URL, SITE_ORIGIN, DEV_SITE_HOSTS } from "@gleam/core/src/models/site-origin.ts";
export { REPO_URL, STORE_REVIEWS_URL, releaseUrl, sitePageUrl, type SitePage } from "@gleam/core/src/models/site-links.ts";

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
