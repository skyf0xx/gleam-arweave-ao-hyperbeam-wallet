import { describe, expect, it, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { verifyRsaPss } from "@gleam/core/src/arweave/rsa-pss.ts";
import { verifyMessage, signMessage, type JWKInterface, type StoragePort } from "@gleam/core";
import { Keyring, KeyringLockedError, generateJWK } from "@gleam/core/signer";
import {
  createKeySession,
  HardwareWalletSigningError,
  isSessionExpired,
  SessionKeyStorageError,
} from "./key-session";

/**
 * Real key/value store, not an in-process cache layered in front of it.
 * Cleared in `beforeEach` so every test starts from an empty store, the
 * same way a freshly-restarted MV3 service worker would see whatever
 * session storage still holds and nothing else. The key half goes to an
 * in-memory `Keyring`, the store the keyring offscreen document runs.
 */
const store = new Map<string, unknown>();

const storage: StoragePort = {
  async get<T>(key: string) {
    return store.has(key) ? (store.get(key) as T) : null;
  },
  async set<T>(key: string, value: T) {
    store.set(key, value);
  },
  async remove(key: string) {
    store.delete(key);
  },
  watch() {
    return () => {};
  },
};

const sessionKeys = new Keyring();

const {
  cacheKey,
  clearKeyCache,
  enforceAutoLock,
  getSigner,
  hasCachedKey,
  isKeyStored,
  reconcileKeyring,
  removeCachedKey,
  withSessionLock,
} = createKeySession({ sessionKeys, storage });

let jwkA: JWKInterface;
let jwkB: JWKInterface;

beforeAll(async () => {
  [jwkA, jwkB] = await Promise.all([generateJWK(), generateJWK()]);
}, 60_000);

function setSession(autoLockTimeout: string, lastActivityAt = Date.now(), unlockedWalletIds = ["wallet-a", "wallet-b"]) {
  store.set("session:unlockedSession", {
    unlockedAt: lastActivityAt,
    lastActivityAt,
    autoLockTimeout,
    unlockedWalletIds,
  });
}

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

const heldKeys = () => sessionKeys.has(["wallet-a", "wallet-b"]);

beforeEach(async () => {
  store.clear();
  await sessionKeys.clear();
  setSession("never");
});

describe("key-session", () => {
  it("keeps only the address and public modulus in session storage, no private key material", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");

    expect(store.get("session:key:wallet-a")).toEqual({ address: "address-a", owner: jwkA.n });
  });

  it("hands the private key to the keyring", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");

    expect(await heldKeys()).toEqual(["wallet-a"]);
  });

  it("signs with the session keys: verifyRsaPss and verifyMessage accept the signatures", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    const signer = (await getSigner("wallet-a"))!;
    const data = bytes("deep hash stand-in");

    const signature = await signer.signPss(data, { hash: "SHA-256", saltLength: 32 });
    await expect(verifyRsaPss(jwkA.n, data, signature)).resolves.toBe(true);

    const message = bytes("hello").buffer;
    await expect(verifyMessage(jwkA.n, message, await signMessage(signer, message, "SHA-512"), "SHA-512")).resolves.toBe(true);
  });

  it("a signer obtained before a lock can't sign after it", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    const signer = (await getSigner("wallet-a"))!;

    await clearKeyCache();

    await expect(signer.signPss(bytes("late"), { hash: "SHA-256", saltLength: 32 })).rejects.toBeInstanceOf(
      KeyringLockedError,
    );
  });

  it("builds the signer from storage on every call (no re-caching in process)", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    expect(await getSigner("wallet-a")).toMatchObject({ owner: jwkA.n, address: "address-a" });

    store.set("session:key:wallet-a", { address: "address-b", owner: jwkB.n });

    expect(await getSigner("wallet-a")).toMatchObject({ owner: jwkB.n, address: "address-b" });
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

  it("treats a wallet whose keyring key is gone as locked", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await sessionKeys.remove("wallet-a");

    expect(await getSigner("wallet-a")).toBeNull();
    expect(await isKeyStored("wallet-a")).toBe(false);
  });

  it("treats a session entry holding a whole JWK, as older releases stored, as locked and scrubs it", async () => {
    store.set("session:key:wallet-a", { jwk: jwkA, address: "address-a" });
    store.set("session:cachedWalletIds", ["wallet-a"]);
    const setSpy = vi.spyOn(storage, "set");

    expect(await getSigner("wallet-a")).toBeNull();

    const zeroized = setSpy.mock.calls.find(([key]) => key === "session:key:wallet-a")?.[1] as { jwk: JWKInterface };
    expect(zeroized.jwk.d).toBe("0".repeat(jwkA.d!.length));
    expect(store.has("session:key:wallet-a")).toBe(false);
    expect(store.get("session:cachedWalletIds")).toEqual([]);
    setSpy.mockRestore();
  });

  it("treats a session entry carrying d, as an earlier build stored, as locked and scrubs it", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    store.set("session:key:wallet-a", { address: "address-a", owner: jwkA.n, d: jwkA.d });
    const setSpy = vi.spyOn(storage, "set");

    expect(await getSigner("wallet-a")).toBeNull();

    const zeroized = setSpy.mock.calls.find(([key]) => key === "session:key:wallet-a")?.[1] as { d: string };
    expect(zeroized.d).toBe("0".repeat(jwkA.d!.length));
    expect(store.has("session:key:wallet-a")).toBe(false);
    expect(await heldKeys()).toEqual([]);
    setSpy.mockRestore();
  });

  it("removeCachedKey only removes the targeted wallet's key", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await cacheKey("wallet-b", jwkB, "address-b");

    await removeCachedKey("wallet-a");

    expect(await getSigner("wallet-a")).toBeNull();
    expect(await heldKeys()).toEqual(["wallet-b"]);
    expect(await getSigner("wallet-b")).toMatchObject({ owner: jwkB.n, address: "address-b" });
  });

  it("clearKeyCache wipes every session entry and every key", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await cacheKey("wallet-b", jwkB, "address-b");

    await clearKeyCache();

    expect(await getSigner("wallet-a")).toBeNull();
    expect(await getSigner("wallet-b")).toBeNull();
    expect(await heldKeys()).toEqual([]);
  });

  it("clearKeyCache also drops keys no session entry tracks", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    store.delete("session:cachedWalletIds");

    await clearKeyCache();

    expect(await heldKeys()).toEqual([]);
  });

  it("clearKeyCache leaves unrelated session storage entries untouched", async () => {
    store.set("session:unlockedSession", { unlockedWalletIds: ["wallet-a"] });
    await cacheKey("wallet-a", jwkA, "address-a");

    await clearKeyCache();

    expect(store.get("session:unlockedSession")).toEqual({ unlockedWalletIds: ["wallet-a"] });
  });

  it("removeCachedKey overwrites the entry's strings with zeros before removing it", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    const setSpy = vi.spyOn(storage, "set");

    await removeCachedKey("wallet-a");

    const zeroizedCall = setSpy.mock.calls.find(([key]) => key === "session:key:wallet-a");
    expect(zeroizedCall).toBeDefined();
    const [, zeroized] = zeroizedCall as [string, { address: string; owner: string }];
    expect(zeroized.owner).toBe("0".repeat(jwkA.n.length));
    expect(zeroized.address).toBe("0".repeat("address-a".length));
    expect(store.has("session:key:wallet-a")).toBe(false);
    setSpy.mockRestore();
  });

  it("clearKeyCache overwrites every cached entry with zeros before removing them", async () => {
    await cacheKey("wallet-a", jwkA, "address-a");
    await cacheKey("wallet-b", jwkB, "address-b");
    const setSpy = vi.spyOn(storage, "set");

    await clearKeyCache();

    const zeroizedKeys = setSpy.mock.calls.filter(([key]) => key.startsWith("session:key:")).map(([key]) => key);
    expect(zeroizedKeys.sort()).toEqual(["session:key:wallet-a", "session:key:wallet-b"]);
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

  describe("reconcileKeyring", () => {
    it("drops every key when no session is left to use them", async () => {
      await cacheKey("wallet-a", jwkA, "address-a");
      store.delete("session:unlockedSession");

      await reconcileKeyring();

      expect(await heldKeys()).toEqual([]);
    });

    it("keeps the keys while a session exists", async () => {
      await cacheKey("wallet-a", jwkA, "address-a");

      await reconcileKeyring();

      expect(await heldKeys()).toEqual(["wallet-a"]);
    });
  });

  describe("withSessionLock", () => {
    it("runs tasks one at a time, in order, even when one fails", async () => {
      const events: string[] = [];
      let release!: () => void;
      const first = withSessionLock(async () => {
        events.push("first:start");
        await new Promise<void>((resolve) => (release = resolve));
        events.push("first:end");
        throw new Error("first failed");
      });
      const second = withSessionLock(async () => {
        events.push("second");
        return "ok";
      });

      await Promise.resolve();
      release();

      await expect(first).rejects.toThrow("first failed");
      await expect(second).resolves.toBe("ok");
      expect(events).toEqual(["first:start", "first:end", "second"]);
    });

    it("auto-lock and reconcile wait for a task already holding the lock", async () => {
      setSession("immediate", Date.now() - 2 * 60 * 1000);
      await cacheKey("wallet-a", jwkA, "address-a");
      let release!: () => void;
      const held = withSessionLock(() => new Promise<void>((resolve) => (release = resolve)));

      const locking = enforceAutoLock();
      store.delete("session:unlockedSession");
      const reconciling = reconcileKeyring();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(await heldKeys()).toEqual(["wallet-a"]);
      release();
      await held;
      await expect(locking).resolves.toBe(false);
      await reconciling;
      expect(await heldKeys()).toEqual([]);
    });

    it("a second key session doesn't wait on this one's lock, so the background builds only one", async () => {
      const other = createKeySession({ sessionKeys, storage });
      const events: string[] = [];
      let release!: () => void;
      const first = withSessionLock(async () => {
        await new Promise<void>((resolve) => (release = resolve));
        events.push("first");
      });
      const second = other.withSessionLock(async () => {
        events.push("other session");
      });
      const third = withSessionLock(async () => {
        events.push("third");
      });

      await second;
      release();
      await Promise.all([first, third]);

      expect(events).toEqual(["other session", "first", "third"]);
    });
  });

  describe("when the keyring fails", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("clearKeyCache still clears the keyring when a session entry can't be removed", async () => {
      await cacheKey("wallet-a", jwkA, "address-a");
      vi.spyOn(storage, "set").mockRejectedValueOnce(new Error("session storage error"));

      await expect(clearKeyCache()).rejects.toThrow("session storage error");

      expect(await heldKeys()).toEqual([]);
    });

    it("clearKeyCache rethrows after removing every session entry", async () => {
      await cacheKey("wallet-a", jwkA, "address-a");
      vi.spyOn(sessionKeys, "clear").mockRejectedValueOnce(new Error("disk error"));

      await expect(clearKeyCache()).rejects.toThrow("disk error");

      expect(store.has("session:key:wallet-a")).toBe(false);
      expect(await getSigner("wallet-a")).toBeNull();
    });

    it("auto-lock rethrows a failed wipe but still ends the session", async () => {
      setSession("immediate", Date.now() - 2 * 60 * 1000);
      await cacheKey("wallet-a", jwkA, "address-a");
      vi.spyOn(sessionKeys, "clear").mockRejectedValueOnce(new Error("disk error"));

      await expect(getSigner("wallet-a")).rejects.toThrow("disk error");

      expect(store.has("session:unlockedSession")).toBe(false);
      expect(store.has("session:key:wallet-a")).toBe(false);
    });

    it("reports a wallet as locked when its keys can't be read", async () => {
      await cacheKey("wallet-a", jwkA, "address-a");
      vi.spyOn(sessionKeys, "has").mockRejectedValue(new Error("disk error"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await getSigner("wallet-a")).toBeNull();
      expect(await isKeyStored("wallet-a")).toBe(false);
    });

    it("cacheKey throws a storage error a caller can tell from a wrong password", async () => {
      vi.spyOn(sessionKeys, "importKey").mockRejectedValueOnce(new Error("keyring gone"));

      await expect(cacheKey("wallet-a", jwkA, "address-a")).rejects.toBeInstanceOf(SessionKeyStorageError);
    });

    it("cacheKey writes no session entry when the keyring refuses the key", async () => {
      vi.spyOn(sessionKeys, "importKey").mockRejectedValueOnce(new Error("keyring gone"));

      await expect(cacheKey("wallet-a", jwkA, "address-a")).rejects.toBeInstanceOf(SessionKeyStorageError);

      expect(store.has("session:key:wallet-a")).toBe(false);
      expect(store.has("session:cachedWalletIds")).toBe(false);
    });

    it("cacheKey reports a session entry that can't be written as a storage error", async () => {
      vi.spyOn(storage, "set").mockRejectedValueOnce(new Error("session storage error"));

      await expect(cacheKey("wallet-a", jwkA, "address-a")).rejects.toBeInstanceOf(SessionKeyStorageError);

      expect(await isKeyStored("wallet-a")).toBe(false);
    });

    it("removeCachedKey still removes the keyring key when the session entry can't be removed", async () => {
      await cacheKey("wallet-a", jwkA, "address-a");
      vi.spyOn(storage, "remove").mockRejectedValueOnce(new Error("session storage error"));

      await expect(removeCachedKey("wallet-a")).rejects.toThrow("session storage error");

      expect(await heldKeys()).toEqual([]);
    });
  });

  describe("auto-lock on key read", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns the key while the session is within its timeout", async () => {
      setSession("5min");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.setSystemTime(Date.now() + 5 * 60 * 1000);

      expect(await getSigner("wallet-a")).toMatchObject({ owner: jwkA.n, address: "address-a" });
    });

    it("once the timeout has passed, returns null and wipes every key and the session", async () => {
      setSession("5min");
      await cacheKey("wallet-a", jwkA, "address-a");
      await cacheKey("wallet-b", jwkB, "address-b");

      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);

      expect(await getSigner("wallet-a")).toBeNull();
      expect(store.has("session:key:wallet-a")).toBe(false);
      expect(store.has("session:key:wallet-b")).toBe(false);
      expect(store.has("session:unlockedSession")).toBe(false);
      expect(await heldKeys()).toEqual([]);
    });

    it("enforceAutoLock leaves a hardware-only vault's session alone, as loadSession does", async () => {
      store.set("local:wallets", [{ id: "wallet-h", address: "address-h", method: "keystone", publicKey: "n" }]);
      setSession("5min", Date.now(), ["wallet-h"]);

      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);

      expect(await enforceAutoLock()).toBe(false);
      expect(store.has("session:unlockedSession")).toBe(true);
    });

    it("enforceAutoLock drops the keys once the timeout passes, without any key read", async () => {
      setSession("5min");
      await cacheKey("wallet-a", jwkA, "address-a");

      expect(await enforceAutoLock()).toBe(false);
      expect(await heldKeys()).toEqual(["wallet-a"]);

      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);

      expect(await enforceAutoLock()).toBe(true);
      expect(await heldKeys()).toEqual([]);
      expect(store.has("session:unlockedSession")).toBe(false);
      expect(store.has("session:key:wallet-a")).toBe(false);
    });

    it("never expires a 'never' session", async () => {
      setSession("never");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.setSystemTime(Date.now() + 365 * 24 * 60 * 60 * 1000);

      expect(await getSigner("wallet-a")).not.toBeNull();
    });

    it("'immediate' keeps the key for a 1-minute grace after the last activity", async () => {
      setSession("immediate");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.setSystemTime(Date.now() + 60 * 1000);

      expect(await getSigner("wallet-a")).toMatchObject({ owner: jwkA.n, address: "address-a" });
    });

    it("'immediate' expires once the 1-minute grace has passed", async () => {
      setSession("immediate");
      await cacheKey("wallet-a", jwkA, "address-a");

      vi.setSystemTime(Date.now() + 60 * 1000 + 1);

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
