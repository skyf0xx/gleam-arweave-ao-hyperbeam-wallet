import { browser } from "wxt/browser";

/**
 * Opens the Ledger connect page in a tab. The WebHID chooser needs a
 * click on an extension page, and the action popup closes when the
 * chooser takes focus.
 */
export async function openLedgerConnect(): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL("/connect.html?device=ledger" as never) });
}
