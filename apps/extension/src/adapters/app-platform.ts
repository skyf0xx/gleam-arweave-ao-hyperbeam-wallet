import { browser } from "wxt/browser";
import type { AppPlatform } from "@/src/app-platform/types";
import { openPasskeyWindow } from "@/src/passkey/open-window";

/**
 * The background keeps each tab's other-wallet report in session storage
 * under `session:siteWallet:tab:<id>` (`handlers/site-wallet.ts`). In the
 * session area itself the key has no `session:` prefix.
 */
const TAB_REPORT_KEY_PREFIX = "siteWallet:tab:";

/**
 * The action popup closes when the browser's passkey prompt takes focus,
 * so only it hands the ceremony to its own window.
 */
export function createExtensionAppPlatform(surface: "popup" | "sidepanel" | "window"): AppPlatform {
  return {
    buildInfo: { version: browser.runtime.getManifest().version },
    capabilities: {
      sidePanel: true,
      passkey: true,
      biometrics: false,
      hardwareWallets: true,
      dappBrowser: false,
      hostPermissions: true,
    },
    hostPermissions: {
      contains: (origins) => browser.permissions.contains({ origins: [...origins] }),
      request: (origins) => browser.permissions.request({ origins: [...origins] }),
    },
    ephemeralState: {
      get: async (key) => (await browser.storage.session.get(key))[key],
      set: (key, value) => browser.storage.session.set({ [key]: value }),
      remove: (key) => browser.storage.session.remove(key),
    },
    unlock: {
      passkeyMode: surface === "popup" ? "window" : "inline",
      openPasskeyWindow,
    },
    activeSite: {
      subscribe(onChange) {
        // Absent outside a real extension page, such as under tests.
        const api = browser as typeof browser | undefined;
        const tabs = api?.tabs;
        const storageChanges = api?.storage?.onChanged;
        const onUpdated = (_tabId: number, change: { url?: string }) => {
          if (change.url) onChange();
        };
        const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
          if (area === "session" && Object.keys(changes).some((key) => key.startsWith(TAB_REPORT_KEY_PREFIX))) onChange();
        };
        tabs?.onActivated?.addListener(onChange);
        tabs?.onUpdated?.addListener(onUpdated);
        storageChanges?.addListener(onStorageChanged);
        return () => {
          tabs?.onActivated?.removeListener(onChange);
          tabs?.onUpdated?.removeListener(onUpdated);
          storageChanges?.removeListener(onStorageChanged);
        };
      },
    },
  };
}
