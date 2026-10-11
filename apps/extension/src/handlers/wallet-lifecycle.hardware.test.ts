import { beforeEach, describe, expect, it, vi } from "vitest";
import { addressFromOwner, bytesToBase64Url, type StoragePort, type Wallet } from "@gleam/core";
import { WalletLifecycleHandler } from "./wallet-lifecycle";
import { getCachedKey, HardwareWalletSigningError } from "./key-session";

/**
 * One store for every key, as the storage adapter routes `local:` and
 * `session:` keys by prefix: key-session reads the wallet list and the
 * session record this handler writes.
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

const PASSWORD = "correct horse battery staple";
const XFP = "1a2b3c4d";

function modulus(bytes = 512, fill = 7): string {
  return bytesToBase64Url(new Uint8Array(bytes).fill(fill));
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

let handler: WalletLifecycleHandler;

beforeEach(() => {
  store.clear();
  handler = new WalletLifecycleHandler(storage);
});

function addKeystone(fill = 7, name?: string) {
  return handler.addHardwareWallet({
    method: "keystone",
    publicKey: modulus(512, fill),
    device: { kind: "keystone", xfp: XFP },
    name,
  });
}

describe("WalletLifecycleHandler: addHardwareWallet", () => {
  it("adds a keyless wallet whose address is the SHA-256 of the modulus, and makes it active", async () => {
    const summary = await addKeystone();

    expect(summary).toMatchObject({
      method: "keystone",
      name: "Keystone 1",
      publicKey: modulus(),
      device: { kind: "keystone", xfp: XFP },
    });
    expect(summary.address).toBe(await addressFromOwner(modulus()));
    expect(summary).not.toHaveProperty("encryptedKeyfile");

    const stored = await storage.get<Wallet[]>("local:wallets");
    expect(stored?.[0]?.encryptedKeyfile).toBeNull();
    expect(await storage.get("local:activeWalletId")).toBe(summary.id);
  });

  it("numbers default names per device type and keeps a given name", async () => {
    await addKeystone(1);
    const second = await addKeystone(2);
    const ledger = await handler.addHardwareWallet({
      method: "ledger",
      publicKey: modulus(512, 3),
      device: { kind: "ledger", model: "nanoX" },
    });
    const named = await addKeystone(4, "Cold storage");

    expect(second.name).toBe("Keystone 2");
    expect(ledger.name).toBe("Ledger 1");
    expect(named.name).toBe("Cold storage");
  });

  it("rejects a public key that isn't 512 bytes", async () => {
    await expect(
      handler.addHardwareWallet({
        method: "keystone",
        publicKey: modulus(256),
        device: { kind: "keystone", xfp: XFP },
      }),
    ).rejects.toThrow(/256-byte public key/);
    expect(await storage.get("local:wallets")).toBeNull();
  });

  it("rejects device details that don't match the method", async () => {
    await expect(
      handler.addHardwareWallet({
        method: "ledger",
        publicKey: modulus(),
        device: { kind: "keystone", xfp: XFP },
      }),
    ).rejects.toThrow(/don't match/);
    await expect(
      handler.addHardwareWallet({
        method: "keystone",
        publicKey: modulus(),
        device: { kind: "keystone", xfp: "not-hex" },
      }),
    ).rejects.toThrow(/don't match/);
  });

  it("refuses an address that is already in the vault", async () => {
    const first = await addKeystone();
    await expect(addKeystone(7, "Again")).rejects.toThrow(`already in Gleam as "${first.name}"`);
    expect(await storage.get<Wallet[]>("local:wallets")).toHaveLength(1);
  });

  it("refuses to add to a locked vault that has a password", async () => {
    await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });
    await handler.lockWallet();

    await expect(addKeystone()).rejects.toThrow(/Unlock Gleam/);
  });

  it("joins an unlocked session in a vault that has a password", async () => {
    const main = await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });
    const keystone = await addKeystone();

    const state = await handler.getState();
    expect(state.session?.unlockedWalletIds).toEqual([main.id, keystone.id]);
  });
});

describe("WalletLifecycleHandler: hardware wallets and the session", () => {
  it("a vault of only hardware wallets is unlocked without a password", async () => {
    const keystone = await addKeystone();

    const state = await handler.getState();
    expect(state.session?.unlockedWalletIds).toEqual([keystone.id]);
  });

  it("loadSession keeps a hardware wallet that has no cached key", async () => {
    const main = await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });
    const keystone = await addKeystone();
    await handler.lockWallet();
    await handler.unlockWallet({ password: PASSWORD });

    const state = await handler.getState();
    expect(state.session?.unlockedWalletIds).toEqual([main.id, keystone.id]);
    expect(await storage.get("session:key:" + keystone.id)).toBeNull();
  });

  it("locking a vault that has a password locks its hardware wallets too", async () => {
    await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });
    await addKeystone();
    await handler.lockWallet();

    expect((await handler.getState()).session).toBeNull();
  });

  it("unlockWallet succeeds when the vault holds only hardware wallets", async () => {
    const keystone = await addKeystone();
    await handler.lockWallet();

    const result = await handler.unlockWallet({ password: "anything" });
    expect(result.unlockedWalletIds).toEqual([keystone.id]);
  });

  it("unlockWallet still rejects a wrong password when a keyfile wallet exists", async () => {
    await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });
    await addKeystone();
    await handler.lockWallet();

    await expect(handler.unlockWallet({ password: "wrong password entirely" })).rejects.toThrow(
      /didn't work/,
    );
  });

  it("deleting the last keyfile wallet leaves the hardware wallets unlocked", async () => {
    const main = await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });
    const keystone = await addKeystone();
    await handler.deleteWallet({ walletId: main.id });

    expect((await handler.getState()).session?.unlockedWalletIds).toEqual([keystone.id]);
  });

  it("adding the first keyfile wallet to a hardware-only vault keeps it unlocked and sets the vault password", async () => {
    const keystone = await addKeystone();
    const created = await handler.createWallet({ name: "Main", password: PASSWORD });

    let state = await handler.getState();
    expect(new Set(state.session?.unlockedWalletIds)).toEqual(new Set([created.id, keystone.id]));
    expect(await getCachedKey(created.id)).not.toBeNull();

    await expect(
      handler.importWallet({ jwk: validJWK(), name: "Other", password: "a different long password" }),
    ).rejects.toThrow(/didn't work/);
    const imported = await handler.importWallet({ jwk: validJWK(), name: "Second", password: PASSWORD });

    state = await handler.getState();
    expect(new Set(state.session?.unlockedWalletIds)).toEqual(new Set([created.id, imported.id, keystone.id]));
    expect(await getCachedKey(created.id)).not.toBeNull();
    expect(await getCachedKey(imported.id)).not.toBeNull();

    await handler.lockWallet();
    expect((await handler.getState()).session).toBeNull();
  }, 60_000);

  it("re-importing a keyfile into a hardware-only session expired by auto-lock keeps it unlocked", async () => {
    const keystone = await addKeystone();
    await handler.setLockSettings({ autoLockTimeout: "immediate" });
    const session = await storage.get<Record<string, unknown>>("session:unlockedSession");
    await storage.set("session:unlockedSession", { ...session, lastActivityAt: 0 });

    const imported = await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });

    const state = await handler.getState();
    expect(new Set(state.session?.unlockedWalletIds)).toEqual(new Set([imported.id, keystone.id]));
    expect(await getCachedKey(imported.id)).not.toBeNull();
  });
});

describe("WalletLifecycleHandler: stored hardware records", () => {
  function storedLedger(overrides: Record<string, unknown>) {
    return {
      id: "ledger-1",
      address: "addr",
      name: "Ledger",
      method: "ledger",
      publicKey: modulus(),
      createdAt: 0,
      updatedAt: 0,
      encryptedKeyfile: null,
      backupConfirmedAt: null,
      device: { kind: "ledger" },
      ...overrides,
    };
  }

  async function storedIds(record: Record<string, unknown>) {
    await storage.set("local:wallets", [record]);
    return (await handler.getState()).wallets.map((wallet) => wallet.id);
  }

  it("keeps a well-formed hardware record", async () => {
    expect(await storedIds(storedLedger({}))).toEqual(["ledger-1"]);
  });

  it("drops a hardware record with no device", async () => {
    expect(await storedIds(storedLedger({ device: undefined }))).toEqual([]);
  });

  it("drops a hardware record whose device is a different kind", async () => {
    expect(await storedIds(storedLedger({ device: { kind: "keystone", xfp: XFP } }))).toEqual([]);
  });

  it("drops a hardware record that carries a keyfile", async () => {
    expect(await storedIds(storedLedger({ encryptedKeyfile: { ciphertext: "x" } }))).toEqual([]);
  });

  it("drops a keyfile record that carries a device", async () => {
    expect(await storedIds(storedLedger({ method: "jwk", encryptedKeyfile: { ciphertext: "x" } }))).toEqual([]);
  });
});

describe("WalletLifecycleHandler: hardware wallets have no key", () => {
  it("exportWallet refuses a hardware wallet", async () => {
    const keystone = await addKeystone();
    await expect(handler.exportWallet({ walletId: keystone.id, password: PASSWORD })).rejects.toThrow(
      /stays on its device/,
    );
  });

  it("importing a keyfile for a hardware wallet's address is refused", async () => {
    const jwk = validJWK();
    // The test JWK's modulus isn't 512 bytes, so point a stored hardware
    // record at its address directly.
    const keystone = await addKeystone();
    const stored = (await storage.get<Wallet[]>("local:wallets"))!;
    stored[0] = { ...stored[0]!, address: await addressFromOwner(jwk.n) };
    await storage.set("local:wallets", stored);

    await expect(handler.importWallet({ jwk, name: "Main", password: PASSWORD })).rejects.toThrow(
      `hardware wallet "${keystone.name}"`,
    );
  });

  it("the signing-key lookup throws the hardware error, not 'locked'", async () => {
    const keystone = await addKeystone();
    await expect(getCachedKey(keystone.id)).rejects.toBeInstanceOf(HardwareWalletSigningError);
    await expect(getCachedKey(keystone.id)).rejects.toThrow(/signs on its device/);
  });
});
