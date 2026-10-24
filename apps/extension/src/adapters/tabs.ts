import { browser } from "wxt/browser";
import type { ExtensionMessenger } from "@webext-core/messaging";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";
import type { TabsPort } from "@/src/runtime/platform";

/**
 * Implements `TabsPort` over `browser.tabs`, pushing through the
 * background's own messenger so each push goes to one `tabId` (its
 * targeted-send overload), never to every tab.
 */
export function createBrowserTabs(messenger: Pick<ExtensionMessenger<ProtocolMap>, "sendMessage">): TabsPort {
  return {
    webTabs: () => browser.tabs.query({ url: ["http://*/*", "https://*/*"] }),
    async activeTab() {
      const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      return tab;
    },
    async reload(tabId) {
      await browser.tabs.reload(tabId);
    },
    async send(tabId, type, data) {
      await messenger.sendMessage(type, data as never, tabId);
    },
  };
}
