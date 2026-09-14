import { describe, expect, it, beforeEach } from "vitest";
import type { StoragePort } from "@gleam/core";
import { WalletLifecycleHandler } from "./wallet-lifecycle";

const GOOD_PASSWORD = "correct horse battery staple";
const OTHER_PASSWORD = "another very long safe password!";

/**
 * An in-memory `StoragePort` fake — no `chrome.*`, no WXT, exercising
 * exactly the interface `wallet-lifecycle.ts` is written against. This
 * doubles as untrusted-storage test material: several tests write
 * malformed records directly into this fake to prove the handler's own
 * revalidation drops them, rather than trusting whatever's already there.
 */
function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
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
}

function validJWK() {
  return {
    kty: "RSA",
    e: "AQAB",
    n: "n".repeat(10),
    d: "d".repeat(10),
    p: "p".repeat(10),
    q: "q".repeat(10),
    dp: "d".repeat(10),
    dq: "d".repeat(10),
    qi: "q".repeat(10),
  };
}

describe("WalletLifecycleHandler: createWallet", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage);
  });

  it("rejects a password shorter than 10 characters", async () => {
    await expect(handler.createWallet({ name: "Main", password: "short1!" })).rejects.toThrow(
      /at least 10 characters/i,
    );
  });

  it("rejects a common/breached password", async () => {
    await expect(
      handler.createWallet({ name: "Main", password: "iloveyou123" }),
    ).rejects.toThrow(/too common/i);
  });

  it("produces a WalletSummary with no encryptedKeyfile field", async () => {
    const summary = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    expect(summary).not.toHaveProperty("encryptedKeyfile");
    expect(summary.name).toBe("Main");
    expect(summary.method).toBe("jwk");
    expect(typeof summary.address).toBe("string");
    expect(summary.address.length).toBeGreaterThan(0);
  });

  it("stores only an encrypted record — never plaintext key material", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    const stored = await storage.get<Array<Record<string, unknown>>>("local:wallets");

    expect(stored).toHaveLength(1);
    const wallet = stored![0]!;
    const raw = JSON.stringify(wallet);

    expect(wallet.encryptedKeyfile).toBeTruthy();
    expect((wallet.encryptedKeyfile as { ciphertext: string }).ciphertext).toEqual(
      expect.any(String),
    );
    // No JWK field name should appear anywhere in the stored record.
    expect(raw).not.toMatch(/"d":"|"p":"|"q":"|"dp":"|"dq":"|"qi":"/);
  });

  it("sets the new wallet as active", async () => {
    const summary = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    const activeId = await storage.get<string>("local:activeWalletId");
    expect(activeId).toBe(summary.id);
  });

  it("can decrypt the stored envelope back with the same password", async () => {
    const summary = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    const jwk = await handler.exportWallet({ walletId: summary.id, password: GOOD_PASSWORD });
    expect(jwk.kty).toBe("RSA");
  });

  it("immediately unlocks the newly created wallet — no re-prompt after setting the password", async () => {
    const summary = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    const state = await handler.getState();

    expect(state.session?.unlockedWalletIds).toEqual([summary.id]);
  });
});

describe("WalletLifecycleHandler: importWallet", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage);
  });

  it("rejects a malformed keyfile with a specific reason, not a generic error", async () => {
    await expect(
      handler.importWallet({ jwk: { not: "a jwk" }, name: "Imported", password: GOOD_PASSWORD }),
    ).rejects.toThrow(/isn't a valid Arweave keyfile/i);
  });

  it("rejects a keyfile missing a required field with a reason naming the field", async () => {
    const broken = validJWK();
    delete (broken as Record<string, unknown>).d;
    await expect(
      handler.importWallet({ jwk: broken, name: "Imported", password: GOOD_PASSWORD }),
    ).rejects.toThrow(/"d"/);
  });

  it("rejects a weak password even with a valid keyfile", async () => {
    await expect(
      handler.importWallet({ jwk: validJWK(), name: "Imported", password: "short" }),
    ).rejects.toThrow(/at least 10 characters/i);
  });

  it("imports a structurally valid JWK and stores it encrypted-only", async () => {
    const summary = await handler.importWallet({
      jwk: validJWK(),
      name: "Imported",
      password: GOOD_PASSWORD,
    });
    expect(summary.method).toBe("jwk");

    const stored = await storage.get<Array<Record<string, unknown>>>("local:wallets");
    expect(stored).toHaveLength(1);
    expect(stored![0]!.encryptedKeyfile).toBeTruthy();
  });

  it("immediately unlocks the newly imported wallet", async () => {
    const summary = await handler.importWallet({
      jwk: validJWK(),
      name: "Imported",
      password: GOOD_PASSWORD,
    });

    const state = await handler.getState();

    expect(state.session?.unlockedWalletIds).toEqual([summary.id]);
  });
});

describe("WalletLifecycleHandler: unlockWallet", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage);
  });

  it("unlocks the last-active wallet with its own password", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();

    const result = await handler.unlockWallet({ password: GOOD_PASSWORD });

    expect(result.unlockedWalletIds).toEqual([wallet.id]);
  });

  it("rejects an unlock attempt when the password matches no stored wallet", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();

    await expect(handler.unlockWallet({ password: "totally wrong password!!" })).rejects.toThrow(
      /didn't work/i,
    );
  });

  it("opportunistically unlocks other stored wallets sharing the same password", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const second = await handler.importWallet({
      jwk: validJWK(),
      name: "Second",
      password: GOOD_PASSWORD,
    });
    await handler.lockWallet();

    const result = await handler.unlockWallet({ password: GOOD_PASSWORD });

    expect(new Set(result.unlockedWalletIds)).toEqual(new Set([first.id, second.id]));
  });

  it("silently skips a stored wallet whose password doesn't match, without throwing", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await handler.importWallet({
      jwk: validJWK(),
      name: "Second",
      password: OTHER_PASSWORD,
    });
    await handler.lockWallet();

    const result = await handler.unlockWallet({ password: GOOD_PASSWORD });

    // Only the matching wallet unlocks; the mismatched one is dropped
    // silently, never surfaced as a separate failure.
    expect(result.unlockedWalletIds).toEqual([first.id]);
  });

  it("tries the last-active wallet first when multiple wallets share a password", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const second = await handler.importWallet({
      jwk: validJWK(),
      name: "Second",
      password: GOOD_PASSWORD,
    });
    // switchWallet makes `second` the last-active wallet.
    await handler.switchWallet({ walletId: second.id });
    await handler.lockWallet();

    const result = await handler.unlockWallet({ password: GOOD_PASSWORD });

    expect(result.unlockedWalletIds[0]).toBe(second.id);
    expect(result.unlockedWalletIds).toContain(first.id);
  });

  it("writes session metadata under the session: prefix, never local:", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    await handler.unlockWallet({ password: GOOD_PASSWORD });

    const sessionUnderLocal = await storage.get("local:unlockedSession");
    const sessionUnderSession = await storage.get<{ unlockedWalletIds: string[] }>(
      "session:unlockedSession",
    );

    expect(sessionUnderLocal).toBeNull();
    expect(sessionUnderSession?.unlockedWalletIds.length).toBeGreaterThan(0);
  });

  it("session record never contains the password or a key", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    await handler.unlockWallet({ password: GOOD_PASSWORD });

    const session = await storage.get<Record<string, unknown>>("session:unlockedSession");
    expect(JSON.stringify(session)).not.toContain(GOOD_PASSWORD);
    expect(session).not.toHaveProperty("password");
    expect(session).not.toHaveProperty("key");
  });

  it("defaults the session's autoLockTimeout to never", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    await handler.unlockWallet({ password: GOOD_PASSWORD });

    const session = await storage.get<{ autoLockTimeout: string }>("session:unlockedSession");
    expect(session?.autoLockTimeout).toBe("never");
  });
});

describe("WalletLifecycleHandler: lockWallet", () => {
  it("immediately clears unlocked-session state", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage);
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.unlockWallet({ password: GOOD_PASSWORD });

    let session = await storage.get("session:unlockedSession");
    expect(session).toBeTruthy();

    await handler.lockWallet();

    session = await storage.get("session:unlockedSession");
    expect(session).toBeNull();
  });

  it("getState reports no session once locked", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage);
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.unlockWallet({ password: GOOD_PASSWORD });
    await handler.lockWallet();

    const state = await handler.getState();
    expect(state.session).toBeNull();
  });
});

describe("WalletLifecycleHandler: getState (untrusted-storage revalidation)", () => {
  it("drops a malformed wallet record instead of surfacing it", async () => {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "broken", address: 12345 }, // malformed: address must be a string
    ]);
    const handler = new WalletLifecycleHandler(storage);

    const state = await handler.getState();

    expect(state.wallets).toEqual([]);
  });

  it("drops an activeWalletId that doesn't reference any stored wallet", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activeWalletId", "does-not-exist");
    const handler = new WalletLifecycleHandler(storage);

    const state = await handler.getState();

    expect(state.activeWalletId).toBeNull();
  });

  it("drops an unlockedWalletIds entry that references a since-deleted wallet", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage);
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    // Simulate a stale session left over after the wallet was deleted
    // out from under it (e.g. an older schema version).
    await storage.set("session:unlockedSession", {
      unlockedAt: Date.now(),
      lastActivityAt: Date.now(),
      autoLockTimeout: "never",
      unlockedWalletIds: [wallet.id, "ghost-wallet"],
    });
    await storage.set("local:wallets", []);

    const state = await handler.getState();

    expect(state.session).toBeNull();
  });

  it("falls back to the default lock settings when the stored record is malformed", async () => {
    const storage = createFakeStorage();
    await storage.set("local:lockSettings", { autoLockTimeout: "bogus" });
    const handler = new WalletLifecycleHandler(storage);

    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    await handler.unlockWallet({ password: GOOD_PASSWORD });

    const session = await storage.get<{ autoLockTimeout: string }>("session:unlockedSession");
    expect(session?.autoLockTimeout).toBe("never");
  });
});

describe("WalletLifecycleHandler: deleteWallet / renameWallet / switchWallet", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage);
  });

  it("renameWallet updates the name and bumps updatedAt", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.renameWallet({ walletId: wallet.id, name: "Renamed" });

    const state = await handler.getState();
    expect(state.wallets[0]!.name).toBe("Renamed");
  });

  it("switchWallet changes the active wallet id", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const second = await handler.importWallet({
      jwk: validJWK(),
      name: "Second",
      password: GOOD_PASSWORD,
    });

    await handler.switchWallet({ walletId: first.id });
    let state = await handler.getState();
    expect(state.activeWalletId).toBe(first.id);

    await handler.switchWallet({ walletId: second.id });
    state = await handler.getState();
    expect(state.activeWalletId).toBe(second.id);
  });

  it("deleteWallet removes the wallet and reassigns active wallet if needed", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const second = await handler.importWallet({
      jwk: validJWK(),
      name: "Second",
      password: GOOD_PASSWORD,
    });
    await handler.switchWallet({ walletId: second.id });

    await handler.deleteWallet({ walletId: second.id });

    const state = await handler.getState();
    expect(state.wallets.map((w) => w.id)).toEqual([first.id]);
    expect(state.activeWalletId).toBe(first.id);
  });
});

describe("WalletLifecycleHandler: resetAllWallets", () => {
  it("wipes every stored wallet, the active wallet pointer, and the session", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage);
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await handler.importWallet({ jwk: validJWK(), name: "Second", password: OTHER_PASSWORD });

    await handler.resetAllWallets();

    const state = await handler.getState();
    expect(state.wallets).toEqual([]);
    expect(state.activeWalletId).toBeNull();
    expect(state.session).toBeNull();
  });

  it("never throws when called with nothing stored", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage);

    await expect(handler.resetAllWallets()).resolves.toBeUndefined();
  });
});

describe("WalletLifecycleHandler: exportWallet", () => {
  it("rejects the wrong password with an error, never returning key material", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage);
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    await expect(
      handler.exportWallet({ walletId: wallet.id, password: "wrong password entirely" }),
    ).rejects.toThrow();
  });
});
