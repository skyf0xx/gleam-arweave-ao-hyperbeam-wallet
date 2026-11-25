import { browser } from "wxt/browser";
import type { HardwareWalletMethod } from "@gleam/core";

/**
 * Opens the connect page in a tab. Keystone's camera prompt doesn't show
 * reliably in the action popup, and Ledger's WebHID chooser needs a click
 * on an extension page; the popup closes when either takes focus.
 */
export async function openConnectPage(device: HardwareWalletMethod): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL(`/connect.html?device=${device}` as never) });
}
