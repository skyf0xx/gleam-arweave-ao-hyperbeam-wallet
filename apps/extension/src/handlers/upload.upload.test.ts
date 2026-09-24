import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import {
  bytesToBase64,
  deriveAddress,
  generateJWK,
  type JWKInterface,
  type StoragePort,
  type UploadTag,
  type Wallet,
} from "@gleam/core";
import { UploadHandler } from "./upload";
import { cacheKey, clearKeyCache } from "./key-session";

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

const WALLET_ID = "wallet-1";

async function createTestWallet(): Promise<{ wallet: Wallet; jwk: JWKInterface }> {
  const jwk = await generateJWK();
  const address = await deriveAddress(jwk);
  return {
    jwk,
    wallet: {
      id: WALLET_ID,
      address,
      name: "Test wallet",
      method: "jwk",
      publicKey: jwk.n,
      createdAt: 0,
      updatedAt: 0,
      backupConfirmedAt: null,
      encryptedKeyfile: null,
    },
  };
}

function textDraft(text: string, tags: UploadTag[] = [], licenseTag: UploadTag | null = null) {
  return {
    contentType: "text/plain",
    data: bytesToBase64(new TextEncoder().encode(text)),
    tags,
    licenseTag,
  };
}

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  keySessionStore.clear();
  await clearKeyCache();
  // getCachedKey only returns keys for wallets an unexpired session lists.
  keySessionStore.set("session:unlockedSession", {
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
    autoLockTimeout: "never",
    unlockedWalletIds: [WALLET_ID],
  });
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await clearKeyCache();
});

function mockBundlerFetch(status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status })) as unknown as typeof fetch;
}

describe("UploadHandler: reviewUpload", () => {
  it("reports no secret-scan match and the correct tag byte size for ordinary content", () => {
    const handler = new UploadHandler(createFakeStorage());
    const review = handler.reviewUpload(
      textDraft("Notes from the field trip.", [{ name: "Content-Type", value: "text/plain" }]),
    );

    expect(review.secretScanMatch).toBeNull();
    expect(review.tagByteSize).toBe("Content-Type".length + "text/plain".length);
  });

  it("flags a payload that looks like a PEM private key with the specific match type", () => {
    const handler = new UploadHandler(createFakeStorage());
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcw\n-----END PRIVATE KEY-----";
    const review = handler.reviewUpload(textDraft(pem));

    expect(review.secretScanMatch).toBe("PEM block");
  });

  it("flags a JWK-shaped JSON payload", () => {
    const handler = new UploadHandler(createFakeStorage());
    const jwkJson = JSON.stringify({
      kty: "RSA",
      n: "sXchDaQebHnPiGvyDOAT4saGEUetSyo9MKLOoWFsueri23bOdgWJ",
      e: "AQAB",
      d: "X4cTteJY_gn4FYPsXB8rdXix5vwsg1FLN5E3EaG6RJoVH-HLLKD9",
    });
    const review = handler.reviewUpload(textDraft(jwkJson));

    expect(review.secretScanMatch).toBe("JWK");
  });
});

describe("UploadHandler: submitUpload", () => {
  it("throws when the secret scan trips, without contacting the bundler", async () => {
    const storage = createFakeStorage();
    const { wallet, jwk } = await createTestWallet();
    await storage.set("local:wallets", [wallet]);
    await cacheKey(WALLET_ID, jwk, wallet.address);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const handler = new UploadHandler(storage);
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0B\n-----END PRIVATE KEY-----";

    await expect(handler.submitUpload({ ...textDraft(pem), walletId: WALLET_ID })).rejects.toThrow(/PEM block/i);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when tags exceed the byte cap, without contacting the bundler", async () => {
    const storage = createFakeStorage();
    const { wallet, jwk } = await createTestWallet();
    await storage.set("local:wallets", [wallet]);
    await cacheKey(WALLET_ID, jwk, wallet.address);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const handler = new UploadHandler(storage);
    const oversizedTags: UploadTag[] = [{ name: "Description", value: "a".repeat(4097) }];

    await expect(
      handler.submitUpload({
        ...textDraft("hello", oversizedTags),
        walletId: WALLET_ID,
      }),
    ).rejects.toThrow(/4,?096|limit/i);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws once the auto-lock timeout has passed, and wipes the cached key", async () => {
    // Only Date is faked, so the handler's own timers and waitFor still run.
    vi.useFakeTimers({ toFake: ["Date"] });
    keySessionStore.set("session:unlockedSession", {
      unlockedAt: Date.now(),
      lastActivityAt: Date.now(),
      autoLockTimeout: "5min",
      unlockedWalletIds: [WALLET_ID],
    });
    try {
      const storage = createFakeStorage();
      const { wallet, jwk } = await createTestWallet();
      await storage.set("local:wallets", [wallet]);
      await cacheKey(WALLET_ID, jwk, wallet.address);
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      const handler = new UploadHandler(storage);

      await expect(
        handler.submitUpload({ ...textDraft("hello world"), walletId: WALLET_ID }),
      ).rejects.toThrow(/locked/);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(keySessionStore.has(`session:key:${WALLET_ID}`)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when the wallet isn't unlocked (no cached signing key)", async () => {
    const storage = createFakeStorage();
    const { wallet } = await createTestWallet();
    await storage.set("local:wallets", [wallet]);

    const handler = new UploadHandler(storage);

    await expect(
      handler.submitUpload({
        ...textDraft("hello world"),
        walletId: WALLET_ID,
      }),
    ).rejects.toThrow(/locked/);
  });

  it("signs and submits a clean upload, returning a txId", async () => {
    const storage = createFakeStorage();
    const { wallet, jwk } = await createTestWallet();
    await storage.set("local:wallets", [wallet]);
    await cacheKey(WALLET_ID, jwk, wallet.address);
    mockBundlerFetch(200);

    const handler = new UploadHandler(storage);
    const result = await handler.submitUpload({
      ...textDraft("hello world", [{ name: "App-Name", value: "Gleam" }]),
      walletId: WALLET_ID,
    });

    expect(typeof result.txId).toBe("string");
    expect(result.txId.length).toBeGreaterThan(0);
  });

  it("throws a descriptive error when the bundler responds with a non-2xx status", async () => {
    const storage = createFakeStorage();
    const { wallet, jwk } = await createTestWallet();
    await storage.set("local:wallets", [wallet]);
    await cacheKey(WALLET_ID, jwk, wallet.address);
    mockBundlerFetch(502);

    const handler = new UploadHandler(storage);

    await expect(
      handler.submitUpload({
        ...textDraft("hello world"),
        walletId: WALLET_ID,
      }),
    ).rejects.toThrow(/502/);
  });
});
