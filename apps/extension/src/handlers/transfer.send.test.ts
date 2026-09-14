import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  deriveAddress,
  encryptToEnvelope,
  generateJWK,
  type StoragePort,
  type Wallet,
} from "@gleam/core";
import { TransferHandler } from "./transfer";

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

const PASSWORD = "correct horse battery staple 42";
const WALLET_ID = "wallet-1";

async function createTestWallet(): Promise<Wallet> {
  const jwk = await generateJWK();
  const address = await deriveAddress(jwk);
  const encryptedKeyfile = await encryptToEnvelope(
    new TextEncoder().encode(JSON.stringify(jwk)) as Uint8Array<ArrayBuffer>,
    PASSWORD,
    WALLET_ID,
    address,
  );
  return {
    id: WALLET_ID,
    address,
    name: "Test wallet",
    method: "jwk",
    publicKey: jwk.n,
    createdAt: 0,
    updatedAt: 0,
    encryptedKeyfile,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

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
    wallet = await createTestWallet();
    await storage.set("local:wallets", [wallet]);
  });

  it("rejects AO token transfers as not yet implemented", async () => {
    const handler = new TransferHandler(storage);
    await expect(
      handler.estimateTransfer({
        walletId: WALLET_ID,
        password: PASSWORD,
        recipient: "someAddr",
        token: "someProcessId",
        amount: "1",
        fee: null,
      }),
    ).rejects.toThrow(/AO tokens/);
  });

  it("returns a fee and firstSeenRecipient=true for a never-seen address", async () => {
    mockFetchSequence([{ status: 200, body: "999" }]);
    const handler = new TransferHandler(storage);

    const estimate = await handler.estimateTransfer({
      walletId: WALLET_ID,
      password: PASSWORD,
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
      password: PASSWORD,
      recipient: "knownAddr",
      token: null,
      amount: "1000",
      fee: null,
    });

    expect(estimate.firstSeenRecipient).toBe(false);
  });
});

describe("TransferHandler: submitTransfer", () => {
  let storage: StoragePort;
  let wallet: Wallet;

  beforeEach(async () => {
    storage = createFakeStorage();
    wallet = await createTestWallet();
    await storage.set("local:wallets", [wallet]);
  });

  it("rejects AO token transfers as not yet implemented", async () => {
    const handler = new TransferHandler(storage);
    await expect(
      handler.submitTransfer({
        walletId: WALLET_ID,
        password: PASSWORD,
        recipient: "someAddr",
        token: "someProcessId",
        amount: "1",
        fee: null,
      }),
    ).rejects.toThrow(/AO tokens/);
  });

  it("throws when the password is wrong", async () => {
    const handler = new TransferHandler(storage);
    await expect(
      handler.submitTransfer({
        walletId: WALLET_ID,
        password: "totally wrong password here",
        recipient: "someAddr",
        token: null,
        amount: "1",
        fee: null,
      }),
    ).rejects.toThrow();
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
      password: PASSWORD,
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
