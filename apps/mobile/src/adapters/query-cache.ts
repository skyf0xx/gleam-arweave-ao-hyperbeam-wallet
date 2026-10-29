import type { QueryCachePort } from "@gleam/app/src/app-platform/types.ts";

const KEY_PREFIX = "gleam:queryCache:";

/**
 * The app's query cache in the web view's `localStorage`, where the app
 * already keeps its other view preferences. It stays out of SQLite, whose
 * only writer is the runtime worker. The OS may clear it under storage
 * pressure, which costs only a skeleton on the next open.
 */
export function createMobileQueryCache(storage: Storage = window.localStorage): QueryCachePort {
  const storedKeys = () => {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    return keys;
  };
  return {
    get: async (key) => storage.getItem(KEY_PREFIX + key),
    set: async (key, value) => storage.setItem(KEY_PREFIX + key, value),
    remove: async (key) => storage.removeItem(KEY_PREFIX + key),
    keys: async () => storedKeys().map((key) => key.slice(KEY_PREFIX.length)),
    clear: async () => {
      for (const key of storedKeys()) storage.removeItem(key);
    },
  };
}
