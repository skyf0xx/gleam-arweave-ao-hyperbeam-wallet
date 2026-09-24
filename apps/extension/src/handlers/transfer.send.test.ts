import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { deriveAddress, generateJWK, type JWKInterface, type StoragePort, type Wallet } from "@gleam/core";
import { TransferHandler } from "./transfer";
import { cacheKey, clearKeyCache } from "./key-session";

const { aoSubmitMock } = vi.hoisted(() => ({ aoSubmitMock: vi.fn() }));
vi.mock("@gleam/core/src/ao/transfer.ts", () => ({ submitTransfer: aoSubmitMock }));

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

const originalFetch = globalThis.fetch;

beforeEach(() => {
  keySessionStore.clear();
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
  aoSubmitMock.mockReset();
  await clearKeyCache();
});

const AO_PROCESS_ID = "aoProcess123";

/**
 * Real `Response` objects (not plain-object stand-ins) — `arweave-js`'s
 * `Api.request` calls `res.headers.get(...)` and `res.clone().json()`
 * internally, which a plain object satisfying only `{ ok, status, json }`
 * doesn't support.
 */
function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/graphql")) {
      return new Response(JSON.stringify({ data: { transactions: { edges: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    const body = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
    return new Response(body, { status: response.status });
  }) as unknown as typeof fetch;
}

describe("TransferHandler: estimateTransfer", () => {
  let storage: StoragePort;
  let wallet: Wallet;

  beforeEach(async () => {
    storage = createFakeStorage();
    const created = await createTestWallet();
    wallet = created.wallet;
    await storage.set("local:wallets", [wallet]);
    await cacheKey(WALLET_ID, created.jwk, wallet.address);
  });

  it("returns fee: null for an AO token transfer — no sender-side fee quote exists for AO", async () => {
    mockFetchSequence([]);
    const handler = new TransferHandler(storage);

    const estimate = await handler.estimateTransfer({
      walletId: WALLET_ID,
      recipient: "someAoRecipient",
      token: AO_PROCESS_ID,
      amount: "1",
      fee: null,
    });

    expect(estimate.fee).toBeNull();
  });

  it("computes firstSeenRecipient for an AO transfer against the same merged AR activity history the AR path uses", async () => {
    await storage.set(`local:activityLog:${wallet.address}`, [
      {
        txId: "prior-tx",
        type: "send",
        status: "confirmed",
        address: "knownAoAddr",
        amount: "1",
        tags: [],
        timestamp: 1,
        token: AO_PROCESS_ID,
      },
    ]);
    mockFetchSequence([]);
    const handler = new TransferHandler(storage);

    const seen = await handler.estimateTransfer({
      walletId: WALLET_ID,
      recipient: "knownAoAddr",
      token: AO_PROCESS_ID,
      amount: "1000",
      fee: null,
    });
    expect(seen.firstSeenRecipient).toBe(false);

    const unseen = await handler.estimateTransfer({
      walletId: WALLET_ID,
      recipient: "brandNewAoAddr",
      token: AO_PROCESS_ID,
      amount: "1000",
      fee: null,
    });
    expect(unseen.firstSeenRecipient).toBe(true);
  });

  it("returns a fee and firstSeenRecipient=true for a never-seen address", async () => {
    mockFetchSequence([{ status: 200, body: "999" }]);
    const handler = new TransferHandler(storage);

    const estimate = await handler.estimateTransfer({
      walletId: WALLET_ID,
      recipient: "brandNewAddr",
      token: null,
      amount: "1000",
      fee: null,
    });

    expect(estimate.fee).toBe("999");
    expect(estimate.firstSeenRecipient).toBe(true);
  });

  it("returns firstSeenRecipient=false when the local log already has that address", async () => {
    await storage.set(`local:activityLog:${wallet.address}`, [
      {
        txId: "prior-tx",
        type: "send",
        status: "confirmed",
        address: "knownAddr",
        amount: "1",
        tags: [],
        timestamp: 1,
      },
    ]);
    mockFetchSequence([{ status: 200, body: "999" }]);
    const handler = new TransferHandler(storage);

    const estimate = await handler.estimateTransfer({
      walletId: WALLET_ID,
      recipient: "knownAddr",
      token: null,
      amount: "1000",
      fee: null,
    });

    expect(estimate.firstSeenRecipient).toBe(false);
  });
});

describe("TransferHandler: getArFee", () => {
  it("returns the gateway's fee quote with no recipient target", async () => {
    mockFetchSequence([{ status: 200, body: "777" }]);
    const handler = new TransferHandler(createFakeStorage());

    const fee = await handler.getArFee();

    expect(fee).toBe("777");
  });
});

describe("TransferHandler: submitTransfer", () => {
  let storage: StoragePort;
  let wallet: Wallet;

  beforeEach(async () => {
    storage = createFakeStorage();
    const created = await createTestWallet();
    wallet = created.wallet;
    await storage.set("local:wallets", [wallet]);
    await cacheKey(WALLET_ID, created.jwk, wallet.address);
  });

  it("submits an AO transfer via core/ao/transfer.ts and writes an optimistic pending activity entry tagged with the token processId", async () => {
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [],
      activePeerUrl: "https://hyperbeam.example.com",
    });
    aoSubmitMock.mockResolvedValue({ messageId: "ao-msg-id-1" });

    const handler = new TransferHandler(storage);
    const result = await handler.submitTransfer({
      walletId: WALLET_ID,
      recipient: "recipientAoAddr",
      token: AO_PROCESS_ID,
      amount: "42",
      fee: null,
    });

    expect(result.txId).toBe("ao-msg-id-1");
    expect(aoSubmitMock).toHaveBeenCalledWith(expect.objectContaining({ kty: "RSA" }), AO_PROCESS_ID, "recipientAoAddr", "42");

    const log = await storage.get<unknown[]>(`local:activityLog:${wallet.address}`);
    expect(log).toHaveLength(1);
    const [entry] = log as Array<Record<string, unknown>>;
    expect(entry?.txId).toBe("ao-msg-id-1");
    expect(entry?.status).toBe("pending");
    expect(entry?.address).toBe("recipientAoAddr");
    expect(entry?.amount).toBe("42");
    expect(entry?.token).toBe(AO_PROCESS_ID);
  });

  it("keeps AO amounts as atomic-integer strings end to end, never a float", async () => {
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [],
      activePeerUrl: "https://hyperbeam.example.com",
    });
    aoSubmitMock.mockResolvedValue({ messageId: "ao-msg-id-2" });
    const huge = "90071992547409930000";

    const handler = new TransferHandler(storage);
    await handler.submitTransfer({
      walletId: WALLET_ID,
      recipient: "recipientAoAddr",
      token: AO_PROCESS_ID,
      amount: huge,
      fee: null,
    });

    const log = await storage.get<unknown[]>(`local:activityLog:${wallet.address}`);
    const [entry] = log as Array<Record<string, unknown>>;
    expect(entry?.amount).toBe(huge);
    expect(typeof entry?.amount).toBe("string");
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
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      const handler = new TransferHandler(storage);
      await expect(
        handler.submitTransfer({
          walletId: WALLET_ID,
          recipient: "someAddr",
          token: null,
          amount: "1",
          fee: null,
        }),
      ).rejects.toThrow(/locked/);
      expect(keySessionStore.has(`session:key:${WALLET_ID}`)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when the wallet isn't unlocked (no cached signing key)", async () => {
    await clearKeyCache();
    const handler = new TransferHandler(storage);
    await expect(
      handler.submitTransfer({
        walletId: WALLET_ID,
        recipient: "someAddr",
        token: null,
        amount: "1",
        fee: null,
      }),
    ).rejects.toThrow(/locked/);
  });

  it("submits the transfer and writes an optimistic pending activity entry immediately", async () => {
    mockFetchSequence([
      { status: 200, body: "anchor12345678901234567890123456789012345678" },
      { status: 200, body: "1234567" },
      { status: 200, body: { ok: true } },
    ]);

    const handler = new TransferHandler(storage);
    const result = await handler.submitTransfer({
      walletId: WALLET_ID,
      recipient: "recipientAddr",
      token: null,
      amount: "1000000000000",
      fee: null,
    });

    expect(typeof result.txId).toBe("string");

    const log = await storage.get<unknown[]>(`local:activityLog:${wallet.address}`);
    expect(log).toHaveLength(1);
    const [entry] = log as Array<Record<string, unknown>>;
    expect(entry?.txId).toBe(result.txId);
    expect(entry?.status).toBe("pending");
    expect(entry?.address).toBe("recipientAddr");
    expect(entry?.amount).toBe("1000000000000");
  });
});
