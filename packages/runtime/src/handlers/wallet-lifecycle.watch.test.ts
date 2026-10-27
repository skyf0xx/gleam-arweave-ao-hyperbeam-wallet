import { beforeEach, describe, expect, it } from "vitest";
import { deriveAddress, type StoragePort, type Wallet } from "@gleam/core";
import { Keyring } from "@gleam/core/signer";
import { WalletLifecycleHandler } from "./wallet-lifecycle";
import { createKeySession, WatchWalletSigningError } from "./key-session";

/** One store for every key, as the storage adapter routes `local:` and `session:` keys by prefix. */
const store = new Map<string, unknown>();

const storage: StoragePort = {
  async get<T>(key: string) {
    return store.has(key) ? (store.get(key) as T) : null;
  },
  async set<T>(key: string, value: T) {
    store.set(key, value);
  },
  async setMany(entries: Record<string, unknown>) {
    for (const [key, value] of Object.entries(entries)) store.set(key, value);
  },
  async remove(key: string) {
    store.delete(key);
  },
  watch() {
    return () => {};
  },
};

const keySession = createKeySession({ sessionKeys: new Keyring(), storage });

const PASSWORD = "correct horse battery staple";
/** Argon2id at its minimum, so tests don't pay the production KDF cost. */
const TEST_KDF = { kdfParams: { memoryKiB: 64, iterations: 1, parallelism: 1 } };
const ADDRESS = "a".repeat(43);

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
  handler = new WalletLifecycleHandler(storage, keySession, TEST_KDF);
});

describe("WalletLifecycleHandler: addWatchWallet", () => {
  it("adds an address with no key and makes it active", async () => {
    const summary = await handler.addWatchWallet({ address: ` ${ADDRESS} `, name: "Cold" });

    expect(summary).toMatchObject({ method: "watch", address: ADDRESS, name: "Cold", publicKey: "" });
    const stored = await storage.get<Wallet[]>("local:wallets");
    expect(stored?.[0]?.encryptedKeyfile).toBeNull();
    expect(await storage.get("local:activeWalletId")).toBe(summary.id);
  });

  it("names an unnamed watch wallet by count", async () => {
    await handler.addWatchWallet({ address: ADDRESS });
    const second = await handler.addWatchWallet({ address: "b".repeat(43), name: "  " });
    expect(second.name).toBe("Watched 2");
  });

  it.each(["", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`])("refuses %j, which isn't an address", async (address) => {
    await expect(handler.addWatchWallet({ address })).rejects.toThrow(/isn't an Arweave address/);
    expect(await storage.get("local:wallets")).toBeNull();
  });

  it("refuses an address that is already in the vault", async () => {
    await handler.addWatchWallet({ address: ADDRESS, name: "First" });
    await expect(handler.addWatchWallet({ address: ADDRESS })).rejects.toThrow('already in Gleam as "First"');
  });

  it("refuses to add to a locked vault that has a password", async () => {
    await handler.importWallet({ jwk: validJWK(), name: "Main", password: PASSWORD });
    await handler.lockWallet();
    await expect(handler.addWatchWallet({ address: ADDRESS })).rejects.toThrow(/Unlock Gleam/);
  });
});

describe("WalletLifecycleHandler: watch wallets and the password", () => {
  it("a vault of only watch wallets is unlocked without a password", async () => {
    const watched = await handler.addWatchWallet({ address: ADDRESS });

    expect(await handler.hasVaultPassword()).toBe(false);
    expect((await handler.getState()).session?.unlockedWalletIds).toEqual([watched.id]);
  });

  it("adding a keyfile later sets the vault password, which then locks the watch wallet too", async () => {
    const watched = await handler.addWatchWallet({ address: ADDRESS });
    const created = await handler.createWallet({ name: "Main", password: PASSWORD });

    expect(await handler.hasVaultPassword()).toBe(true);
    expect(new Set((await handler.getState()).session?.unlockedWalletIds)).toEqual(new Set([created.id, watched.id]));

    await handler.lockWallet();
    expect((await handler.getState()).session).toBeNull();
    const { unlockedWalletIds } = await handler.unlockWallet({ password: PASSWORD });
    expect(new Set(unlockedWalletIds)).toEqual(new Set([created.id, watched.id]));
  }, 60_000);

  it("the first keyfile must meet the password policy, as on first run", async () => {
    await handler.addWatchWallet({ address: ADDRESS });
    await expect(handler.createWallet({ name: "Main", password: "short" })).rejects.toThrow();
  });
});

describe("WalletLifecycleHandler: watch wallets can't sign", () => {
  it("the signing-key lookup throws the watch error, not 'locked'", async () => {
    const watched = await handler.addWatchWallet({ address: ADDRESS });
    await expect(keySession.getSigner(watched.id)).rejects.toBeInstanceOf(WatchWalletSigningError);
  });

  it("downloadKeyfile refuses a watch wallet", async () => {
    const downloads = {
      isAllowed: async () => true,
      ensureAllowed: async () => true,
      saveFile: async () => ({ ok: true as const, filename: "x.json" }),
    };
    handler = new WalletLifecycleHandler(storage, keySession, { ...TEST_KDF, downloads });
    const watched = await handler.addWatchWallet({ address: ADDRESS });
    await expect(handler.downloadKeyfile({ walletId: watched.id, password: PASSWORD })).rejects.toThrow(/watch-only/);
  });

  it("importing a keyfile for a watched address is refused", async () => {
    const jwk = validJWK();
    await handler.addWatchWallet({ address: await deriveAddress(jwk), name: "Cold" });
    await expect(handler.importWallet({ jwk, name: "Main", password: PASSWORD })).rejects.toThrow(
      /watch-only wallet "Cold"/,
    );
  });

  it("drops a stored watch record that carries a keyfile", async () => {
    const watched = await handler.addWatchWallet({ address: ADDRESS });
    const [record] = (await storage.get<Wallet[]>("local:wallets"))!;
    await storage.set("local:wallets", [{ ...record, encryptedKeyfile: { version: 2 } }]);
    expect((await handler.getState()).wallets.map((wallet) => wallet.id)).not.toContain(watched.id);
  });
});
