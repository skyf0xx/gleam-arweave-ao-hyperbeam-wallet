import { browser } from "wxt/browser";

/**
 * Opens the connect page in a tab. The camera prompt doesn't show
 * reliably in the action popup, which also closes when it loses focus.
 */
export async function openKeystoneConnect(): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL("/connect.html?device=keystone" as never) });
}
