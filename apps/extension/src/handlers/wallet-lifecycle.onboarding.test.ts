import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as hashWasm from "hash-wasm";
import {
  bytesToBase64,
  VaultKdfError,
  type DownloadPort,
  type FileDownloadResult,
  type JWKInterface,
  type StoragePort,
  type VaultEnvelope,
  type Wallet,
} from "@gleam/core";
import { WalletLifecycleHandler } from "./wallet-lifecycle";
import { getSigner, clearKeyCache } from "./key-session";
import { sessionKeyStore } from "../adapters/session-key-store";

vi.mock("hash-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("hash-wasm")>();
  return { ...actual, argon2id: vi.fn(actual.argon2id) };
});

/**
 * Real key/value store standing in for `adapters/storage.ts`'s
 * `storagePort`, backing `key-session.ts`'s accessors — not an in-process
 * cache, so tests exercise the same "read fresh from storage" behavior
 * `key-session.ts` relies on.
 */
const keySessionStore = new Map<string, unknown>();

vi.mock("../adapters/storage", () => ({
  storagePort: {
    async get(key: string) {
      return keySessionStore.has(key) ? keySessionStore.get(key) : null;
    },
    async set(key: string, value: unknown) {
      keySessionStore.set(key, value);
    },
    async remove(key: string) {
      keySessionStore.delete(key);
    },
    watch() {
      return () => {};
    },
  },
}));

beforeEach(async () => {
  keySessionStore.clear();
  await sessionKeyStore.clear();
});

/**
 * A `DownloadPort` that keeps a copy of each saved file. The handler
 * zeroizes its buffer once the save resolves, so the copy is taken here.
 */
function fakeDownloads(result?: FileDownloadResult, allowed = true) {
  const saved: Array<{ filename: string; mimeType: string; text: string; bytes: Uint8Array }> = [];
  // Like `permissions.onAdded`, one grant releases every waiter.
  const waiters = new Set<(allowed: boolean) => void>();
  let granted = allowed;
  const port: DownloadPort = {
    async isAllowed() {
      return granted;
    },
    ensureAllowed: vi.fn(async (signal?: AbortSignal) => {
      if (granted) return true;
      return new Promise<boolean>((resolve) => {
        waiters.add(resolve);
        signal?.addEventListener("abort", () => {
          waiters.delete(resolve);
          resolve(false);
        });
      });
    }),
    async saveFile({ filename, mimeType, bytes }) {
      saved.push({ filename, mimeType, text: new TextDecoder().decode(bytes), bytes });
      return result ?? { ok: true, filename };
    },
  };
  const grant = () => {
    granted = true;
    for (const resolve of waiters) resolve(true);
    waiters.clear();
  };
  const deny = () => {
    for (const resolve of waiters) resolve(false);
    waiters.clear();
  };
  return { port, saved, grant, deny, waiters };
}

async function downloadedJwk(storage: StoragePort, walletId: string, password: string): Promise<JWKInterface> {
  const downloads = fakeDownloads();
  await new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port }).downloadKeyfile({ walletId, password });
  return JSON.parse(downloads.saved[0]!.text) as JWKInterface;
}

const GOOD_PASSWORD = "correct horse battery staple";
/** Argon2id at its minimum, so tests don't pay the production KDF cost. */
const TEST_KDF = { kdfParams: { memoryKiB: 64, iterations: 1, parallelism: 1 } };
const OTHER_PASSWORD = "another very long safe password!";

/**
 * An in-memory `StoragePort` fake — no `chrome.*`, no WXT, exercising
 * exactly the interface `wallet-lifecycle.ts` is written against. This
 * doubles as untrusted-storage test material: several tests write
 * malformed records directly into this fake to prove the handler's own
 * revalidation drops them, rather than trusting whatever's already there.
 */
function createFakeStorage(): StoragePort {
  const localStore = new Map<string, unknown>();
  // `session:` keys share key-session's store, as they share
  // chrome.storage.session in the extension: getSigner reads the
  // session record this handler writes.
  const areaFor = (key: string) => (key.startsWith("session:") ? keySessionStore : localStore);
  return {
    async get<T>(key: string) {
      return areaFor(key).has(key) ? (areaFor(key).get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      areaFor(key).set(key, value);
    },
    async remove(key: string) {
      areaFor(key).delete(key);
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
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
  });

  it("rejects a password shorter than 8 characters", async () => {
    await expect(handler.createWallet({ name: "Main", password: "short1!" })).rejects.toThrow(
      /at least 8 characters/i,
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
    const jwk = await downloadedJwk(storage, summary.id, GOOD_PASSWORD);
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
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
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
    ).rejects.toThrow(/at least 8 characters/i);
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

  it("importing the same keyfile again switches to the existing wallet instead of duplicating it", async () => {
    const jwk = validJWK();
    const first = await handler.importWallet({ jwk, name: "Imported", password: GOOD_PASSWORD });

    await handler.createWallet({ name: "Second", password: GOOD_PASSWORD });
    const second = await handler.importWallet({
      jwk,
      name: "Imported again",
      password: GOOD_PASSWORD,
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Imported");

    const state = await handler.getState();
    expect(state.wallets).toHaveLength(2);
    expect(state.activeWalletId).toBe(first.id);
  });

  it("re-importing the same keyfile leaves it unlocked", async () => {
    const jwk = validJWK();
    const first = await handler.importWallet({ jwk, name: "Imported", password: GOOD_PASSWORD });
    await handler.lockWallet();

    await handler.importWallet({ jwk, name: "Imported", password: GOOD_PASSWORD });

    const state = await handler.getState();
    expect(state.session?.unlockedWalletIds).toEqual([first.id]);
  });
});

describe("WalletLifecycleHandler: adding a wallet to an existing vault", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
  });

  it("createWallet rejects a password that doesn't open the vault, and stores nothing", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });

    await expect(
      handler.createWallet({ name: "Second", password: OTHER_PASSWORD }),
    ).rejects.toThrow(/didn't work/i);

    const state = await handler.getState();
    expect(state.wallets).toHaveLength(1);
  });

  it("importWallet rejects a password that doesn't open the vault, and stores nothing", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });

    await expect(
      handler.importWallet({ jwk: validJWK(), name: "Second", password: OTHER_PASSWORD }),
    ).rejects.toThrow(/didn't work/i);

    const state = await handler.getState();
    expect(state.wallets).toHaveLength(1);
  });

  it("createWallet with the vault password adds an unlocked, active wallet under that password", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });

    const second = await handler.createWallet({ name: "Second", password: GOOD_PASSWORD });

    const state = await handler.getState();
    expect(state.wallets.map((wallet) => wallet.id)).toEqual([first.id, second.id]);
    expect(state.activeWalletId).toBe(second.id);
    expect(new Set(state.session?.unlockedWalletIds)).toEqual(new Set([first.id, second.id]));
    await handler.lockWallet();
    const unlocked = await handler.unlockWallet({ password: GOOD_PASSWORD });
    expect(new Set(unlocked.unlockedWalletIds)).toEqual(new Set([first.id, second.id]));
  });

  it("importWallet with the vault password adds the wallet", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });

    const imported = await handler.importWallet({
      jwk: validJWK(),
      name: "Imported",
      password: GOOD_PASSWORD,
    });

    const jwk = await downloadedJwk(storage, imported.id, GOOD_PASSWORD);
    expect(jwk.n).toBe(validJWK().n);
  });

  it("accepts the vault password even when it predates the password policy", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const [wallet] = (await storage.get<Array<Record<string, unknown>>>("local:wallets"))!;
    // Re-encrypt the first wallet under a password the policy now rejects.
    const jwk = await downloadedJwk(storage, wallet!.id as string, GOOD_PASSWORD);
    const { encryptToEnvelope } = await import("@gleam/core");
    const weak = "short1!";
    const envelope = await encryptToEnvelope(
      new TextEncoder().encode(JSON.stringify(jwk)) as Uint8Array<ArrayBuffer>,
      weak,
      wallet!.id as string,
      wallet!.address as string,
      { params: TEST_KDF.kdfParams },
    );
    await storage.set("local:wallets", [{ ...wallet, encryptedKeyfile: envelope }]);

    const second = await handler.createWallet({ name: "Second", password: weak });

    expect(second.name).toBe("Second");
  });

  it("accepts a password that opens any stored wallet, not only the active one", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const otherStorage = createFakeStorage();
    await new WalletLifecycleHandler(otherStorage, TEST_KDF).importWallet({
      jwk: validJWK(),
      name: "Legacy",
      password: OTHER_PASSWORD,
    });
    const legacy = (await otherStorage.get<unknown[]>("local:wallets"))!;
    const current = (await storage.get<unknown[]>("local:wallets"))!;
    await storage.set("local:wallets", [...current, ...legacy]);

    await expect(
      handler.createWallet({ name: "Third", password: OTHER_PASSWORD }),
    ).resolves.toMatchObject({ name: "Third" });
  });
});

describe("WalletLifecycleHandler: unlockWallet", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
  });

  it("unlocks the last-active wallet with its own password", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();

    const result = await handler.unlockWallet({ password: GOOD_PASSWORD });

    expect(result.unlockedWalletIds).toEqual([wallet.id]);
  });

  it("hands the unlocked key to the keyring and drops it on lock", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    await handler.unlockWallet({ password: GOOD_PASSWORD });

    expect(await sessionKeyStore.has([wallet.id])).toEqual([wallet.id]);

    await handler.lockWallet();

    expect(await sessionKeyStore.has([wallet.id])).toEqual([]);
    expect(await getSigner(wallet.id)).toBeNull();
  });

  it("a lock sent while an unlock is running waits for it, then leaves no key or session", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();

    const unlocking = handler.unlockWallet({ password: GOOD_PASSWORD });
    const locking = handler.lockWallet();
    await Promise.all([unlocking, locking]);

    expect(await sessionKeyStore.has([wallet.id])).toEqual([]);
    expect((await handler.getState()).session).toBeNull();
  });

  it("a failed unlock drops the keys it had already imported", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await handler.createWallet({ name: "Second", password: GOOD_PASSWORD });
    await handler.lockWallet();
    const importKey = sessionKeyStore.importKey.bind(sessionKeyStore);
    vi.spyOn(sessionKeyStore, "importKey")
      .mockImplementationOnce(importKey)
      .mockRejectedValueOnce(new Error("keyring gone"));

    await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).rejects.toThrow(/couldn't keep the wallet unlocked/);

    expect(await sessionKeyStore.has([first.id])).toEqual([]);
    expect((await handler.getState()).session).toBeNull();
    vi.restoreAllMocks();
  });

  describe("when the keyring fails", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("unlockWallet reports the keyring failure, not a wrong password", async () => {
      await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
      await handler.lockWallet();
      vi.spyOn(sessionKeyStore, "importKey").mockRejectedValue(new Error("keyring gone"));

      await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).rejects.toThrow(
        /couldn't keep the wallet unlocked/,
      );
    });

    it("createWallet reports the keyring failure", async () => {
      vi.spyOn(sessionKeyStore, "importKey").mockRejectedValue(new Error("keyring gone"));

      await expect(handler.createWallet({ name: "Main", password: GOOD_PASSWORD })).rejects.toThrow(
        /couldn't keep the wallet unlocked/,
      );
    });

    it("lockWallet surfaces a failed key wipe but still locks every wallet", async () => {
      const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
      vi.spyOn(sessionKeyStore, "clear").mockRejectedValueOnce(new Error("disk error"));

      await expect(handler.lockWallet()).rejects.toThrow("disk error");

      expect((await handler.getState()).session).toBeNull();
      expect(await getSigner(wallet.id)).toBeNull();
    });

    it("resetAllWallets surfaces a failed key wipe but still wipes the vault", async () => {
      await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
      vi.spyOn(sessionKeyStore, "clear").mockRejectedValueOnce(new Error("disk error"));

      await expect(handler.resetAllWallets()).rejects.toThrow("disk error");

      const state = await handler.getState();
      expect(state.wallets).toEqual([]);
      expect(state.session).toBeNull();
    });

    it("deleteWallet surfaces a failed key removal but still removes the wallet", async () => {
      const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
      vi.spyOn(sessionKeyStore, "remove").mockRejectedValueOnce(new Error("disk error"));

      await expect(handler.deleteWallet({ walletId: wallet.id })).rejects.toThrow("disk error");

      expect((await handler.getState()).wallets).toEqual([]);
    });

    it("getState reports the wallet locked instead of failing when the keyring can't be reached", async () => {
      await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
      vi.spyOn(sessionKeyStore, "has").mockRejectedValue(new Error("keyring gone"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect((await handler.getState()).session).toBeNull();
    });
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
    // A vault can hold a wallet under a different password than the
    // shared one; seed that case directly since the handler always
    // creates wallets under the shared password.
    const otherStorage = createFakeStorage();
    await new WalletLifecycleHandler(otherStorage, TEST_KDF).importWallet({
      jwk: validJWK(),
      name: "Second",
      password: OTHER_PASSWORD,
    });
    const legacy = (await otherStorage.get<unknown[]>("local:wallets"))!;
    const current = (await storage.get<unknown[]>("local:wallets"))!;
    await storage.set("local:wallets", [...current, ...legacy]);
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

/** A version 1 envelope as every Gleam release before Argon2id wrote it. */
async function encryptV1(text: string, password: string, walletId: string, address: string): Promise<VaultEnvelope> {
  const encode = (value: string) => new TextEncoder().encode(value);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encode(`gleam:v1:${walletId}:${address}`) },
    key,
    encode(text),
  );
  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-HMAC-SHA256",
    iterations: 600_000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

describe("WalletLifecycleHandler: Argon2id envelope upgrade on unlock", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  async function storedWallets(): Promise<Wallet[]> {
    return (await storage.get<Wallet[]>("local:wallets"))!;
  }

  /** Rewrites every stored keyfile as a version 1 envelope under `password`. */
  async function downgradeToV1(password = GOOD_PASSWORD): Promise<void> {
    const wallets = await storedWallets();
    const legacy = await Promise.all(
      wallets.map(async (wallet) => {
        const jwk = await downloadedJwk(storage, wallet.id, GOOD_PASSWORD);
        const envelope = await encryptV1(JSON.stringify(jwk), password, wallet.id, wallet.address);
        return { ...wallet, encryptedKeyfile: envelope };
      }),
    );
    await storage.set("local:wallets", legacy);
  }

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
  });

  it("creates wallets with version 2 Argon2id envelopes", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    const [wallet] = await storedWallets();
    expect(wallet!.encryptedKeyfile).toMatchObject({ version: 2, kdf: "Argon2id", ...TEST_KDF.kdfParams });
  });

  it("re-encrypts a version 1 envelope as version 2 on unlock, and the result still unlocks", async () => {
    const created = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await downgradeToV1();
    await handler.lockWallet();

    await handler.unlockWallet({ password: GOOD_PASSWORD });
    await handler.envelopeUpgradeSettled();

    const [wallet] = await storedWallets();
    expect(wallet!.encryptedKeyfile).toMatchObject({ version: 2, kdf: "Argon2id" });
    await handler.lockWallet();
    await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).resolves.toEqual({
      unlockedWalletIds: [created.id],
    });
    const jwk = await downloadedJwk(storage, created.id, GOOD_PASSWORD);
    expect(jwk.kty).toBe("RSA");
  });

  it("gives every upgraded wallet in the vault one shared salt", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await handler.importWallet({ jwk: validJWK(), name: "Second", password: GOOD_PASSWORD });
    await downgradeToV1();
    await handler.lockWallet();

    await handler.unlockWallet({ password: GOOD_PASSWORD });
    await handler.envelopeUpgradeSettled();

    const [first, second] = await storedWallets();
    expect(first!.encryptedKeyfile!.version).toBe(2);
    expect(second!.encryptedKeyfile!.salt).toBe(first!.encryptedKeyfile!.salt);
    expect(second!.encryptedKeyfile!.iv).not.toBe(first!.encryptedKeyfile!.iv);
  });

  it("adds a wallet under the vault's existing salt", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await handler.importWallet({ jwk: validJWK(), name: "Second", password: GOOD_PASSWORD });

    const [first, second] = await storedWallets();
    expect(second!.encryptedKeyfile!.salt).toBe(first!.encryptedKeyfile!.salt);
  });

  it("leaves a wallet under a different password on version 1", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await handler.importWallet({ jwk: validJWK(), name: "Second", password: GOOD_PASSWORD });
    const [first, second] = await storedWallets();
    const jwk = await downloadedJwk(storage, second!.id, GOOD_PASSWORD);
    const otherV1 = await encryptV1(JSON.stringify(jwk), OTHER_PASSWORD, second!.id, second!.address);
    await storage.set("local:wallets", [first, { ...second, encryptedKeyfile: otherV1 }]);
    await handler.lockWallet();

    await handler.unlockWallet({ password: GOOD_PASSWORD });
    await handler.envelopeUpgradeSettled();

    const [, after] = await storedWallets();
    expect(after!.encryptedKeyfile).toEqual(otherV1);
  });

  it("keeps the version 1 envelope and still unlocks when writing the upgrade fails", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await downgradeToV1();
    const [legacy] = await storedWallets();
    await handler.lockWallet();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = storage.set.bind(storage);
    storage.set = async (key, value) => {
      if (key === "local:wallets") throw new Error("QUOTA_BYTES quota exceeded");
      return set(key, value);
    };

    await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).resolves.toMatchObject({
      unlockedWalletIds: [legacy!.id],
    });
    await handler.envelopeUpgradeSettled();

    const [after] = await storedWallets();
    expect(after!.encryptedKeyfile).toEqual(legacy!.encryptedKeyfile);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    storage.set = set;
    await handler.lockWallet();
    await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).resolves.toMatchObject({
      unlockedWalletIds: [legacy!.id],
    });
  });

  it("does not overwrite a keyfile that changed while the unlock ran", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await downgradeToV1();
    const [legacy] = await storedWallets();
    await handler.lockWallet();
    const replacement = await encryptV1("{}", GOOD_PASSWORD, legacy!.id, legacy!.address);
    const get = storage.get.bind(storage);
    let walletReads = 0;
    storage.get = async <T,>(key: string) => {
      // The upgrade re-reads the wallets just before writing; by then
      // something else has replaced this keyfile.
      if (key === "local:wallets" && ++walletReads === 2) {
        await storage.set("local:wallets", [{ ...legacy, encryptedKeyfile: replacement }]);
      }
      return get<T>(key);
    };

    await handler.unlockWallet({ password: GOOD_PASSWORD });
    await handler.envelopeUpgradeSettled();

    const [after] = await storedWallets();
    expect(after!.encryptedKeyfile).toEqual(replacement);
  });

  it("resolves the unlock before the upgrade is written", async () => {
    const created = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await downgradeToV1();
    const [legacy] = await storedWallets();
    await handler.lockWallet();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const get = storage.get.bind(storage);
    let walletReads = 0;
    storage.get = async <T,>(key: string) => {
      if (key === "local:wallets" && ++walletReads === 2) await held;
      return get<T>(key);
    };

    await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).resolves.toEqual({
      unlockedWalletIds: [created.id],
    });
    expect(await storage.get("session:unlockedSession")).not.toBeNull();
    const beforeRelease = (await get<Wallet[]>("local:wallets"))!;
    expect(beforeRelease[0]!.encryptedKeyfile).toEqual(legacy!.encryptedKeyfile);

    release();
    await handler.envelopeUpgradeSettled();
    expect((await storedWallets())[0]!.encryptedKeyfile!.version).toBe(2);
  });

  it("does not drop a write that landed while an import was encrypting", async () => {
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    // A version 1 vault gives the import a fresh salt, so its encrypt runs Argon2id cold.
    await downgradeToV1();
    vi.mocked(hashWasm.argon2id).mockImplementationOnce(async (options) => {
      // Another context (an envelope upgrade, a rename) writes meanwhile.
      const [first] = await storedWallets();
      await storage.set("local:wallets", [{ ...first!, name: "Renamed meanwhile" }]);
      const actual = await vi.importActual<typeof import("hash-wasm")>("hash-wasm");
      return actual.argon2id(options);
    });

    await handler.importWallet({ jwk: validJWK(), name: "Second", password: GOOD_PASSWORD });

    const wallets = await storedWallets();
    expect(wallets.map((wallet) => wallet.name)).toEqual(["Renamed meanwhile", "Second"]);
  });

  it("re-encrypts a version 2 envelope once the Argon2id cost is raised", async () => {
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    const raised = { memoryKiB: 128, iterations: 2, parallelism: 1 };

    const raisedHandler = new WalletLifecycleHandler(storage, { kdfParams: raised });
    await raisedHandler.unlockWallet({ password: GOOD_PASSWORD });
    await raisedHandler.envelopeUpgradeSettled();

    const [wallet] = await storedWallets();
    expect(wallet!.encryptedKeyfile).toMatchObject({ version: 2, ...raised });
  });
});

describe("WalletLifecycleHandler: key derivation failures", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;
  const wasmFailure = () => new RangeError("WebAssembly.Memory(): could not allocate memory");

  beforeEach(async () => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
  });

  async function corruptFirstEnvelope(): Promise<void> {
    const [first, ...rest] = (await storage.get<Wallet[]>("local:wallets"))!;
    const envelope = { ...first!.encryptedKeyfile!, memoryKiB: 8 * 1024 * 1024 } as VaultEnvelope;
    await storage.set("local:wallets", [{ ...first!, encryptedKeyfile: envelope }, ...rest]);
  }

  it("reports an Argon2id failure on unlock, not a wrong password", async () => {
    vi.mocked(hashWasm.argon2id).mockRejectedValueOnce(wasmFailure());

    const unlock = handler.unlockWallet({ password: GOOD_PASSWORD });

    await expect(unlock).rejects.toBeInstanceOf(VaultKdfError);
    await expect(unlock).rejects.toThrow(/couldn't run its password check/);
  });

  it("reports a corrupted envelope on unlock when no wallet opens", async () => {
    await corruptFirstEnvelope();

    await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).rejects.toThrow(/corrupted/);
  });

  it("still unlocks the other wallets when one envelope is corrupted", async () => {
    const second = await handler.importWallet({ jwk: validJWK(), name: "Second", password: GOOD_PASSWORD });
    await handler.lockWallet();
    await corruptFirstEnvelope();

    await expect(handler.unlockWallet({ password: GOOD_PASSWORD })).resolves.toEqual({
      unlockedWalletIds: [second.id],
    });
  });

  it("still reports a wrong password as one", async () => {
    await expect(handler.unlockWallet({ password: OTHER_PASSWORD })).rejects.toThrow(/didn't work/);
  });

  it("reports an Argon2id failure when checking the vault password", async () => {
    vi.mocked(hashWasm.argon2id).mockRejectedValueOnce(wasmFailure());

    await expect(handler.checkVaultPassword({ password: GOOD_PASSWORD })).rejects.toBeInstanceOf(VaultKdfError);
  });

  it("reports an Argon2id failure when adding a wallet", async () => {
    vi.mocked(hashWasm.argon2id).mockRejectedValueOnce(wasmFailure());

    await expect(
      handler.importWallet({ jwk: validJWK(), name: "Second", password: GOOD_PASSWORD }),
    ).rejects.toBeInstanceOf(VaultKdfError);
  });

  it("does not leak the raw WASM error from downloadKeyfile", async () => {
    const [wallet] = (await storage.get<Wallet[]>("local:wallets"))!;
    vi.mocked(hashWasm.argon2id).mockRejectedValueOnce(wasmFailure());

    const exported = new WalletLifecycleHandler(storage, { downloads: fakeDownloads().port }).downloadKeyfile({
      walletId: wallet!.id,
      password: GOOD_PASSWORD,
    });

    await expect(exported).rejects.toThrow(/couldn't run its password check/);
    await expect(exported).rejects.not.toThrow(/WebAssembly/);
  });
});

describe("WalletLifecycleHandler: lockWallet", () => {
  it("immediately clears unlocked-session state", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
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
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.unlockWallet({ password: GOOD_PASSWORD });
    await handler.lockWallet();

    const state = await handler.getState();
    expect(state.session).toBeNull();
  });
});

describe("WalletLifecycleHandler: getLockSettings", () => {
  it("defaults to never when nothing is stored", async () => {
    const handler = new WalletLifecycleHandler(createFakeStorage(), TEST_KDF);
    expect(await handler.getLockSettings()).toEqual({ autoLockTimeout: "never" });
  });

  it("reflects a value previously written by setLockSettings", async () => {
    const handler = new WalletLifecycleHandler(createFakeStorage(), TEST_KDF);
    await handler.setLockSettings({ autoLockTimeout: "5min" });
    expect(await handler.getLockSettings()).toEqual({ autoLockTimeout: "5min" });
  });

  it("drops a malformed stored record back to the default (untrusted storage)", async () => {
    const storage = createFakeStorage();
    await storage.set("local:lockSettings", { autoLockTimeout: "not-a-real-timeout" });
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    expect(await handler.getLockSettings()).toEqual({ autoLockTimeout: "never" });
  });
});

describe("WalletLifecycleHandler: getThemePreference", () => {
  it("defaults to light when nothing is stored", async () => {
    const handler = new WalletLifecycleHandler(createFakeStorage(), TEST_KDF);
    expect(await handler.getThemePreference()).toEqual({ theme: "light" });
  });

  it("reflects a value previously written by setThemePreference", async () => {
    const handler = new WalletLifecycleHandler(createFakeStorage(), TEST_KDF);
    await handler.setThemePreference({ theme: "dark" });
    expect(await handler.getThemePreference()).toEqual({ theme: "dark" });
  });

  it("drops a malformed stored record back to the default (untrusted storage)", async () => {
    const storage = createFakeStorage();
    await storage.set("local:themeSettings", { theme: "not-a-real-theme" });
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    expect(await handler.getThemePreference()).toEqual({ theme: "light" });
  });

  it("defaults to light for a fresh install with no stored preference at all", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    expect(await storage.get("local:themeSettings")).toBeNull();
    expect(await handler.getThemePreference()).toEqual({ theme: "light" });
  });
});

describe("WalletLifecycleHandler: setThemePreference", () => {
  it("rejects a value that isn't exactly light or dark", async () => {
    const handler = new WalletLifecycleHandler(createFakeStorage(), TEST_KDF);
    await expect(
      handler.setThemePreference({ theme: "system" as never }),
    ).rejects.toThrow(/invalid theme preference/i);
  });

  it("persists across a fresh handler instance (popup close/reopen)", async () => {
    const storage = createFakeStorage();
    const first = new WalletLifecycleHandler(storage, TEST_KDF);
    await first.setThemePreference({ theme: "dark" });

    const second = new WalletLifecycleHandler(storage, TEST_KDF);
    expect(await second.getThemePreference()).toEqual({ theme: "dark" });
  });
});

describe("WalletLifecycleHandler: getState (untrusted-storage revalidation)", () => {
  it("drops a malformed wallet record instead of surfacing it", async () => {
    const storage = createFakeStorage();
    await storage.set("local:wallets", [
      { id: "broken", address: 12345 }, // malformed: address must be a string
    ]);
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);

    const state = await handler.getState();

    expect(state.wallets).toEqual([]);
  });

  it("drops an activeWalletId that doesn't reference any stored wallet", async () => {
    const storage = createFakeStorage();
    await storage.set("local:activeWalletId", "does-not-exist");
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);

    const state = await handler.getState();

    expect(state.activeWalletId).toBeNull();
  });

  it("drops an unlockedWalletIds entry that references a since-deleted wallet", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
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
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);

    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    await handler.unlockWallet({ password: GOOD_PASSWORD });

    const session = await storage.get<{ autoLockTimeout: string }>("session:unlockedSession");
    expect(session?.autoLockTimeout).toBe("never");
  });
});

describe("WalletLifecycleHandler: unlocked-session key caching + auto-lock", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
  });

  afterEach(async () => {
    await clearKeyCache();
  });

  it("unlockWallet caches the wallet's decrypted signing key so later calls don't need the password again", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    await handler.lockWallet();
    expect(await getSigner(wallet.id)).toBeNull();

    await handler.unlockWallet({ password: GOOD_PASSWORD });

    expect(await getSigner(wallet.id)).not.toBeNull();
  });

  it("lockWallet clears every cached signing key immediately", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    expect(await getSigner(wallet.id)).not.toBeNull();

    await handler.lockWallet();

    expect(await getSigner(wallet.id)).toBeNull();
  });

  it("an elapsed auto-lock timeout clears the session and the cached key on the next getState", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    expect(await getSigner(wallet.id)).not.toBeNull();

    // Simulate a session whose "immediate" timeout (1-minute grace) has
    // already elapsed — the same shape unlockWallet would have written,
    // but with an activity timestamp far enough in the past.
    await storage.set("session:unlockedSession", {
      unlockedAt: Date.now() - 120_000,
      lastActivityAt: Date.now() - 120_000,
      autoLockTimeout: "immediate",
      unlockedWalletIds: [wallet.id],
    });

    const state = await handler.getState();

    expect(state.session).toBeNull();
    expect(await getSigner(wallet.id)).toBeNull();
  });

  it("a session within its auto-lock timeout stays unlocked and keeps its cached key", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    await storage.set("session:unlockedSession", {
      unlockedAt: Date.now(),
      lastActivityAt: Date.now(),
      autoLockTimeout: "5min",
      unlockedWalletIds: [wallet.id],
    });

    const state = await handler.getState();

    expect(state.session).not.toBeNull();
    expect(await getSigner(wallet.id)).not.toBeNull();
  });

  it("getState reports locked and drops the session when every cached key is gone", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    // The key cache can empty without lockWallet running (e.g. the
    // session area being cleared under a live session record).
    keySessionStore.delete(`session:key:${wallet.id}`);

    const state = await handler.getState();

    expect(state.session).toBeNull();
    expect(await storage.get("session:unlockedSession")).toBeNull();
  });

  it("getState drops only the wallets whose key is missing and persists the pruned session", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const second = await handler.createWallet({ name: "Second", password: GOOD_PASSWORD });
    keySessionStore.delete(`session:key:${first.id}`);

    const state = await handler.getState();

    expect(state.session?.unlockedWalletIds).toEqual([second.id]);
    const stored = await storage.get<{ unlockedWalletIds: string[] }>("session:unlockedSession");
    expect(stored?.unlockedWalletIds).toEqual([second.id]);
    expect(await getSigner(second.id)).not.toBeNull();
  });

  it("createWallet leaves every created wallet unlocked and signable", async () => {
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const second = await handler.createWallet({ name: "Second", password: GOOD_PASSWORD });

    const state = await handler.getState();

    expect(state.session?.unlockedWalletIds).toEqual([first.id, second.id]);
    expect(await getSigner(first.id)).not.toBeNull();
    expect(await getSigner(second.id)).not.toBeNull();
  });

  it("getState refreshes lastActivityAt, extending the session on activity", async () => {
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });
    const staleTimestamp = Date.now() - 1000;
    await storage.set("session:unlockedSession", {
      unlockedAt: staleTimestamp,
      lastActivityAt: staleTimestamp,
      autoLockTimeout: "5min",
      unlockedWalletIds: [wallet.id],
    });

    await handler.getState();

    const session = await storage.get<{ lastActivityAt: number }>("session:unlockedSession");
    expect(session!.lastActivityAt).toBeGreaterThan(staleTimestamp);
  });
});

describe("WalletLifecycleHandler: deleteWallet / renameWallet / switchWallet", () => {
  let storage: StoragePort;
  let handler: WalletLifecycleHandler;

  beforeEach(() => {
    storage = createFakeStorage();
    handler = new WalletLifecycleHandler(storage, TEST_KDF);
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
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await handler.importWallet({ jwk: validJWK(), name: "Second", password: GOOD_PASSWORD });

    await handler.resetAllWallets();

    const state = await handler.getState();
    expect(state.wallets).toEqual([]);
    expect(state.activeWalletId).toBeNull();
    expect(state.session).toBeNull();
  });

  it("removes each wallet's activity log and watched tokens, and nothing else's", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    const wallet = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    await storage.set(`local:activityLog:${wallet.address}`, [{ id: "tx" }]);
    await storage.set(`local:watchedProcessIds:${wallet.address}`, ["process"]);
    await storage.set("local:networkSettings", { gatewayUrl: "https://arweave.net" });

    await handler.resetAllWallets();

    expect(await storage.get(`local:activityLog:${wallet.address}`)).toBeNull();
    expect(await storage.get(`local:watchedProcessIds:${wallet.address}`)).toBeNull();
    expect(await storage.get("local:networkSettings")).toEqual({ gatewayUrl: "https://arweave.net" });
  });

  it("never throws when called with nothing stored", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);

    await expect(handler.resetAllWallets()).resolves.toBeUndefined();
  });
});

describe("WalletLifecycleHandler: downloadKeyfile", () => {
  it("saves the wallet's standard keyfile JSON and returns only the outcome", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads();
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.importWallet({ jwk: validJWK(), name: "Rose Quartz", password: GOOD_PASSWORD });

    const result = await handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });

    expect(result).toEqual({ ok: true, filename: "rose-quartz-arweave-keyfile.json" });
    expect(JSON.stringify(result)).not.toContain(validJWK().n);
    expect(downloads.saved).toHaveLength(1);
    expect(downloads.saved[0]!.filename).toBe("rose-quartz-arweave-keyfile.json");
    expect(downloads.saved[0]!.mimeType).toBe("application/json");
    expect(JSON.parse(downloads.saved[0]!.text)).toEqual(validJWK());
  });

  it("zeroizes the decrypted bytes once the save settles", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads();
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    await handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });

    expect(downloads.saved[0]!.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("records the backup itself once the file is saved", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: fakeDownloads().port });
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    await handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });

    const state = await handler.getState();
    expect(state.wallets[0]!.backupConfirmedAt).toEqual(expect.any(Number));
  });

  it.each([["cancelled" as const], ["failed" as const]])(
    "passes a %s download back and leaves the wallet not backed up",
    async (reason) => {
      const storage = createFakeStorage();
      const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: fakeDownloads({ ok: false, reason }).port });
      const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

      await expect(handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD })).resolves.toEqual({
        ok: false,
        reason,
      });
      expect((await handler.getState()).wallets[0]!.backupConfirmedAt).toBeNull();
    },
  );

  it("saves nothing when the downloads permission never arrives", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads(undefined, false);
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    const download = handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });
    await vi.waitFor(() => expect(downloads.waiters.size).toBe(1));
    downloads.deny();

    await expect(download).resolves.toEqual({ ok: false, reason: "permission" });
    expect(downloads.saved).toEqual([]);
    expect((await handler.getState()).wallets[0]!.backupConfirmedAt).toBeNull();
  });

  it("saves once the grant arrives", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads(undefined, false);
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.importWallet({ jwk: validJWK(), name: "Main", password: GOOD_PASSWORD });

    const download = handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });
    await vi.waitFor(() => expect(downloads.waiters.size).toBe(1));
    downloads.grant();

    await expect(download).resolves.toEqual({ ok: true, filename: "main-arweave-keyfile.json" });
    expect(JSON.parse(downloads.saved[0]!.text)).toEqual(validJWK());
  });

  it("rejects a wrong password before waiting for the grant", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads(undefined, false);
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    await expect(
      handler.downloadKeyfile({ walletId: wallet.id, password: "wrong password entirely" }),
    ).rejects.toThrow();
    expect(downloads.port.ensureAllowed).not.toHaveBeenCalled();
  });

  it("a retry ends the older call still waiting, so one grant saves one file", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads(undefined, false);
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    const first = handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });
    await vi.waitFor(() => expect(downloads.waiters.size).toBe(1));
    const second = handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });

    await expect(first).resolves.toEqual({ ok: false, reason: "permission" });
    await vi.waitFor(() => expect(downloads.waiters.size).toBe(1));
    downloads.grant();

    await expect(second).resolves.toEqual({ ok: true, filename: "main-arweave-keyfile.json" });
    expect(downloads.saved).toHaveLength(1);
  });

  it("cancelKeyfileDownload ends a call waiting for the grant", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads(undefined, false);
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    const download = handler.downloadKeyfile({ walletId: wallet.id, password: GOOD_PASSWORD });
    await vi.waitFor(() => expect(downloads.waiters.size).toBe(1));
    handler.cancelKeyfileDownload({ walletId: wallet.id });

    await expect(download).resolves.toEqual({ ok: false, reason: "permission" });
    downloads.grant();
    expect(downloads.saved).toEqual([]);
  });

  it("rejects the wrong password and saves nothing", async () => {
    const storage = createFakeStorage();
    const downloads = fakeDownloads();
    const handler = new WalletLifecycleHandler(storage, { ...TEST_KDF, downloads: downloads.port });
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    await expect(
      handler.downloadKeyfile({ walletId: wallet.id, password: "wrong password entirely" }),
    ).rejects.toThrow();
    expect(downloads.saved).toEqual([]);
  });
});

describe("WalletLifecycleHandler: confirmWalletBackup", () => {
  it("a new wallet starts with no confirmed backup", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    expect(wallet.backupConfirmedAt).toBeNull();
    const state = await handler.getState();
    expect(state.wallets[0]!.backupConfirmedAt).toBeNull();
  });

  it("records a timestamp once confirmed, surfaced through getState", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    const wallet = await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    const before = Date.now();
    await handler.confirmWalletBackup({ walletId: wallet.id });
    const after = Date.now();

    const state = await handler.getState();
    const confirmedAt = state.wallets[0]!.backupConfirmedAt;
    expect(confirmedAt).not.toBeNull();
    expect(confirmedAt).toBeGreaterThanOrEqual(before);
    expect(confirmedAt).toBeLessThanOrEqual(after);
  });

  it("throws for an unknown wallet id rather than silently no-op-ing", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    await handler.createWallet({ name: "Main", password: GOOD_PASSWORD });

    await expect(handler.confirmWalletBackup({ walletId: "no-such-wallet" })).rejects.toThrow();
  });

  it("does not affect other wallets' backup status", async () => {
    const storage = createFakeStorage();
    const handler = new WalletLifecycleHandler(storage, TEST_KDF);
    const first = await handler.createWallet({ name: "First", password: GOOD_PASSWORD });
    const second = await handler.importWallet({
      jwk: validJWK(),
      name: "Second",
      password: GOOD_PASSWORD,
    });

    await handler.confirmWalletBackup({ walletId: first.id });

    const state = await handler.getState();
    const firstState = state.wallets.find((w) => w.id === first.id)!;
    const secondState = state.wallets.find((w) => w.id === second.id)!;
    expect(firstState.backupConfirmedAt).not.toBeNull();
    expect(secondState.backupConfirmedAt).toBeNull();
  });
});
