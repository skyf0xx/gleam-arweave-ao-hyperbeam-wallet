import { browser } from "wxt/browser";
import type { QueryCachePort } from "@gleam/app/src/app-platform/types.ts";

/** Keeps these entries apart from the background's own `local:` keys, which WXT stores unprefixed. */
const KEY_PREFIX = "queryCache:";

/**
 * The app's query cache in `chrome.storage.local`, shared by the popup and
 * the side panel and kept across browser restarts.
 */
export function createExtensionQueryCache(): QueryCachePort {
  const storedKeys = async () =>
    Object.keys(await browser.storage.local.get(null)).filter((key) => key.startsWith(KEY_PREFIX));
  return {
    get: async (key) => {
      const value: unknown = (await browser.storage.local.get(KEY_PREFIX + key))[KEY_PREFIX + key];
      return typeof value === "string" ? value : null;
    },
    set: (key, value) => browser.storage.local.set({ [KEY_PREFIX + key]: value }),
    remove: (key) => browser.storage.local.remove(KEY_PREFIX + key),
    keys: async () => (await storedKeys()).map((key) => key.slice(KEY_PREFIX.length)),
    clear: async () => {
      const keys = await storedKeys();
      if (keys.length > 0) await browser.storage.local.remove(keys);
    },
  };
}
