import { storage } from "wxt/utils/storage";
import type { StorageArea, StorageItemKey } from "wxt/utils/storage";
import type { StoragePort } from "@gleam/core";

/**
 * Implements `StoragePort` over WXT's `storage` API (`wxt/utils/storage`,
 * itself `@wxt-dev/storage`'s `storage.getItem`/`setItem`/`removeItem`/
 * `watch`) — the only place `chrome.storage.*` is reached in this repo,
 * per the ports/adapters split. `core` never imports this file; it only
 * sees `StoragePort`.
 *
 * `StoragePort.get`/`set`/`remove`/`watch` are shape-agnostic on storage
 * area on purpose (`core/ports/storage.ts`'s doc comment) — the caller's
 * `key` must already carry the `local:`/`session:`/`sync:` prefix WXT's
 * `StorageItemKey` requires. This adapter validates that prefix rather
 * than assuming callers get it right, since a missing/invalid prefix
 * would otherwise throw deep inside `@wxt-dev/storage` with a less
 * actionable message.
 */
const VALID_AREAS: readonly StorageArea[] = ["local", "session", "sync", "managed"];

function assertStorageItemKey(key: string): StorageItemKey {
  const separatorIndex = key.indexOf(":");
  const area = separatorIndex === -1 ? "" : key.slice(0, separatorIndex);
  if (!VALID_AREAS.includes(area as StorageArea)) {
    throw new Error(
      `Invalid storage key "${key}": must be prefixed with one of ${VALID_AREAS.join(", ")} (e.g. "local:wallets").`,
    );
  }
  return key as StorageItemKey;
}

export class WxtStoragePort implements StoragePort {
  async get<T>(key: string): Promise<T | null> {
    return storage.getItem<T>(assertStorageItemKey(key));
  }

  async set<T>(key: string, value: T): Promise<void> {
    await storage.setItem<T>(assertStorageItemKey(key), value);
  }

  async setMany(entries: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(entries).map(assertStorageItemKey);
    if (keys.length === 0) return;
    const nullish = Object.keys(entries).find((key) => entries[key] == null);
    if (nullish !== undefined) {
      throw new Error(`setMany value for "${nullish}" is null or undefined; use remove to delete a key.`);
    }
    const areas = new Set(keys.map((key) => key.slice(0, key.indexOf(":"))));
    if (areas.size > 1) {
      throw new Error(`setMany keys must share one storage area, got ${[...areas].join(", ")}.`);
    }
    // `setItems` groups by area into a single `chrome.storage.<area>.set`,
    // which Chrome commits atomically; per-key `setItem` calls would not be.
    await storage.setItems(keys.map((key) => ({ key, value: entries[key] })));
  }

  async remove(key: string): Promise<void> {
    await storage.removeItem(assertStorageItemKey(key));
  }

  watch<T>(key: string, cb: (value: T | null) => void): () => void {
    return storage.watch<T>(assertStorageItemKey(key), (newValue) => cb(newValue));
  }
}
