import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
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

const {
  cacheKey,
  clearKeyCache,
  getSigner,
  HardwareWalletSigningError,
  hasCachedKey,
  isKeyStored,
  isSessionExpired,
  removeCachedKey,
} = await import("./key-session");

const jwkA = { kty: "RSA", n: "wallet-a-n", e: "AQAB" } as unknown as JWKInterface;
const jwkB = { kty: "RSA", n: "wallet-b-n", e: "AQAB" } as unknown as JWKInterface;

function setSession(autoLockTimeout: string, lastActivityAt = Date.now(), unlockedWalletIds = ["wallet-a", "wallet-b"]) {
  store.set("session:unlockedSession", {
    unlockedAt: lastActivityAt,
    lastActivityAt,
    autoLockTimeout,
    unlockedWalletIds,
  });
}

beforeEach(() => {
  store.clear();
  setSession("never");
});

describe("key-session", () => {
  it("builds the signer from a key read fresh from storage on every call (no re-caching in process)", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");

    const first = await getSigner("wallet-a");
    expect(first).toMatchObject({ owner: "wallet-a-n", address: "address-a" });

    // Simulate another process reading the same underlying store directly:
    // mutating storage between reads must be visible on the next read, which
    // is only possible if the key read never caches in-process itself.
    store.set("session:key:wallet-a", { jwk: jwkB, address: "address-b" });
    const second = await getSigner("wallet-a");
    expect(second).toMatchObject({ owner: "wallet-b-n", address: "address-b" });
  });

  it("returns null for a wallet that was never cached", async () => {
    expect(await getSigner("missing-wallet")).toBeNull();
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

    expect(await getSigner("wallet-a")).toBeNull();
    expect(await getSigner("wallet-b")).toMatchObject({ owner: "wallet-b-n", address: "address-b" });
  });

  it("clearKeyCache wipes every cached key", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await cacheKey("wallet-b", jwkB, "address-b");

    await clearKeyCache();

    expect(await getSigner("wallet-a")).toBeNull();
    expect(await getSigner("wallet-b")).toBeNull();
  });

  it("clearKeyCache leaves unrelated session storage entries untouched", async () => {
    store.set("session:unlockedSession", { unlockedWalletIds: ["wallet-a"] });
    await cacheKey("wallet-a", jwkA, "address-a");

    await clearKeyCache();

    expect(store.get("session:unlockedSession")).toEqual({ unlockedWalletIds: ["wallet-a"] });
  });

  it("removeCachedKey overwrites the JWK's string fields with zeros before removing the entry", async () => {
    const jwk = { kty: "RSA", n: "secret-n", e: "AQAB", d: "secret-d" } as unknown as JWKInterface;
    await cacheKey("wallet-a", jwk, "address-a");

    const setSpy = vi.spyOn(await import("../adapters/storage").then((m) => m.storagePort), "set");

    await removeCachedKey("wallet-a");

    const zeroizedCall = setSpy.mock.calls.find(([key]) => key === "session:key:wallet-a");
    expect(zeroizedCall).toBeDefined();
    const [, zeroizedValue] = zeroizedCall as [string, { jwk: JWKInterface; address: string }];
    expect(zeroizedValue.jwk.n).toBe("0".repeat("secret-n".length));
    expect((zeroizedValue.jwk as unknown as { d: string }).d).toBe("0".repeat("secret-d".length));
    expect(zeroizedValue.address).toBe("0".repeat("address-a".length));

    // and the entry is actually gone afterward, not just overwritten
    expect(await getSigner("wallet-a")).toBeNull();
    setSpy.mockRestore();
  });

  it("clearKeyCache overwrites every cached JWK's string fields with zeros before removing them", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await cacheKey("wallet-b", jwkB, "address-b");

    const setSpy = vi.spyOn(await import("../adapters/storage").then((m) => m.storagePort), "set");

    await clearKeyCache();

    const zeroizedKeys = setSpy.mock.calls
      .filter(([key]) => key.startsWith("session:key:"))
      .map(([key]) => key);
    expect(zeroizedKeys.sort()).toEqual(["session:key:wallet-a", "session:key:wallet-b"]);

    expect(await getSigner("wallet-a")).toBeNull();
    expect(await getSigner("wallet-b")).toBeNull();
    setSpy.mockRestore();
  });

  it("getSigner throws HardwareWalletSigningError for a hardware wallet instead of reporting it locked", async () => {
    store.set("local:wallets", [{ id: "wallet-a", address: "address-a", method: "keystone", publicKey: "wallet-a-n" }]);

    await expect(getSigner("wallet-a")).rejects.toBeInstanceOf(HardwareWalletSigningError);
  });

  it("isKeyStored reports a stored key even when no session lists the wallet", async () => {
    store.delete("session:unlockedSession");
    expect(await isKeyStored("wallet-a")).toBe(false);

    await cacheKey("wallet-a", jwkA, "address-a");

    expect(await isKeyStored("wallet-a")).toBe(true);
    expect(await getSigner("wallet-a")).toBeNull();
  });

  describe("auto-lock on key read", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns the key while the session is within its timeout", async () => {
      setSession("5min");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(await getSigner("wallet-a")).toMatchObject({ owner: "wallet-a-n", address: "address-a" });
    });

    it("once the timeout has passed, returns null and wipes every key and the session", async () => {
      setSession("5min");
      await cacheKey("wallet-a", jwkA, "address-a");
      await cacheKey("wallet-b", jwkB, "address-b");

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(await getSigner("wallet-a")).toBeNull();
      expect(store.has("session:key:wallet-a")).toBe(false);
      expect(store.has("session:key:wallet-b")).toBe(false);
      expect(store.has("session:unlockedSession")).toBe(false);
    });

    it("never expires a 'never' session", async () => {
      setSession("never");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);

      expect(await getSigner("wallet-a")).not.toBeNull();
    });

    it("'immediate' keeps the key for a 1-minute grace after the last activity", async () => {
      setSession("immediate");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.advanceTimersByTime(60 * 1000);

      expect(await getSigner("wallet-a")).toMatchObject({ owner: "wallet-a-n", address: "address-a" });
    });

    it("'immediate' expires once the 1-minute grace has passed", async () => {
      setSession("immediate");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.advanceTimersByTime(60 * 1000 + 1);

      expect(await getSigner("wallet-a")).toBeNull();
      expect(store.has("session:key:wallet-a")).toBe(false);
      expect(store.has("session:unlockedSession")).toBe(false);
    });

    it("returns null when there is no session, even if a key is stored", async () => {
      await cacheKey("wallet-a", jwkA, "address-a");
      store.delete("session:unlockedSession");

      expect(await getSigner("wallet-a")).toBeNull();
    });

    it("returns null for a wallet the session doesn't list", async () => {
      setSession("never", Date.now(), ["wallet-b"]);
      await cacheKey("wallet-a", jwkA, "address-a");

      expect(await getSigner("wallet-a")).toBeNull();
    });
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

    it("'immediate' allows a 1-minute grace rather than expiring at 0ms", () => {
      expect(isSessionExpired(Date.now(), "immediate")).toBe(false);
      expect(isSessionExpired(Date.now() - 60 * 1000, "immediate")).toBe(false);
      expect(isSessionExpired(Date.now() - (60 * 1000 + 1), "immediate")).toBe(true);
    });
  });
});
