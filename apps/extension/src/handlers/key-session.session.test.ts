import { describe, expect, it, beforeEach, vi } from "vitest";
import type { JWKInterface } from "@gleam/core";

/**
 * Real key/value store standing in for `adapters/storage.ts`'s
 * `storagePort`, not an in-process cache layered in front of it.
 * Reassigned fresh in `beforeEach` so every test starts from an empty
 * store, the same way a freshly-restarted MV3 service worker would see
 * whatever session storage still holds and nothing else.
 */
const store = new Map<string, unknown>();

vi.mock("../adapters/storage", () => ({
  storagePort: {
    async get(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  },
}));

const { cacheKey, clearKeyCache, getCachedKey, hasCachedKey, isSessionExpired, removeCachedKey } = await import(
  "./key-session"
);

const jwkA = { kty: "RSA", n: "wallet-a-n", e: "AQAB" } as unknown as JWKInterface;
const jwkB = { kty: "RSA", n: "wallet-b-n", e: "AQAB" } as unknown as JWKInterface;

beforeEach(() => {
  store.clear();
});

describe("key-session", () => {
  it("reads a cached key fresh from storage on every call (no re-caching in process)", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");

    const first = await getCachedKey("wallet-a");
    expect(first).toEqual({ jwk: jwkA, address: "address-a" });

    // Simulate another process reading the same underlying store directly:
    // mutating storage between reads must be visible on the next read, which
    // is only possible if getCachedKey never caches in-process itself.
    store.set("session:key:wallet-a", { jwk: jwkB, address: "address-b" });
    const second = await getCachedKey("wallet-a");
    expect(second).toEqual({ jwk: jwkB, address: "address-b" });
  });

  it("returns null for a wallet that was never cached", async () => {
    expect(await getCachedKey("missing-wallet")).toBeNull();
    expect(await hasCachedKey("missing-wallet")).toBe(false);
  });

  it("hasCachedKey reflects whether a key is present", async () => {
    expect(await hasCachedKey("wallet-a")).toBe(false);
    await cacheKey("wallet-a", jwkA, "address-a");
    expect(await hasCachedKey("wallet-a")).toBe(true);
  });

  it("removeCachedKey only removes the targeted wallet's key", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await cacheKey("wallet-b", jwkB, "address-b");

    await removeCachedKey("wallet-a");

    expect(await getCachedKey("wallet-a")).toBeNull();
    expect(await getCachedKey("wallet-b")).toEqual({ jwk: jwkB, address: "address-b" });
  });

  it("clearKeyCache wipes every cached key", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await cacheKey("wallet-b", jwkB, "address-b");

    await clearKeyCache();

    expect(await getCachedKey("wallet-a")).toBeNull();
    expect(await getCachedKey("wallet-b")).toBeNull();
  });

  it("clearKeyCache leaves unrelated session storage entries untouched", async () => {
    store.set("session:unlockedSession", { unlockedWalletIds: ["wallet-a"] });
    await cacheKey("wallet-a", jwkA, "address-a");

    await clearKeyCache();

    expect(store.get("session:unlockedSession")).toEqual({ unlockedWalletIds: ["wallet-a"] });
  });

  describe("isSessionExpired", () => {
    it("never expires when the timeout is 'never'", () => {
      expect(isSessionExpired(0, "never")).toBe(false);
    });

    it("expires once elapsed time exceeds the configured timeout", () => {
      const lastActivityAt = Date.now() - 10 * 60 * 1000;
      expect(isSessionExpired(lastActivityAt, "5min")).toBe(true);
      expect(isSessionExpired(Date.now(), "5min")).toBe(false);
    });
  });
});
