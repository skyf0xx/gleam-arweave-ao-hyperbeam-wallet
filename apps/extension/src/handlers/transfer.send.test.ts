import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { deriveAddress, generateJWK, type JWKInterface, type StoragePort, type Wallet } from "@gleam/core";
import { TransferHandler } from "./transfer";
import { cacheKey, clearKeyCache } from "./key-session";

/**
 * `@permaweb/aoconnect` is a direct dependency of `packages/core` only
 * (per this task's INHERITED DECISIONS), not of `apps/extension` — so a
 * bare-specifier `vi.mock("@permaweb/aoconnect", ...)` here resolves
 * against *this* package's own module graph, which pnpm's strict
 * `node_modules` never even has that package in, and silently fails to
 * intercept the copy `core/ao/transfer.ts` actually imports (resolved
 * through `packages/core`'s own `node_modules`). Mocking by the same
 * absolute resolved path both import sites resolve to works around that
 * without adding a duplicate workspace dependency purely for test
 * resolution — see this task's final report for the scope note.
 */
const { aoMessageMock, aoconnectResolvedPath } = vi.hoisted(() => {
  // vi.hoisted runs before ESM imports are initialized, so a static `import`
  // of createRequire isn't available yet at this point; require() is the
  // only way to reach it here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require("node:module") as typeof import("node:module");
  const requireFromCore = createRequire(`${process.cwd()}/packages/core/package.json`);
  // Vite's ESM resolver follows the package's "import" export condition
  // (`dist/index.js`), not Node's CJS `require.resolve` default
  // (`dist/index.cjs`) — mock the exact id Vite's module graph loads, or
  // the mock silently misses and the real network-calling module runs.
  const cjsEntry = requireFromCore.resolve("@permaweb/aoconnect");
  return {
    aoMessageMock: vi.fn(),
    aoconnectResolvedPath: cjsEntry.replace(/index\.cjs$/, "index.js"),
  };
});
vi.mock(aoconnectResolvedPath, () => ({
  connect: () => ({ message: aoMessageMock }),
  createDataItemSigner: (jwk: unknown) => ({ __signerFor: jwk }),
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
      encryptedKeyfile: null,
    },
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  aoMessageMock.mockReset();
  clearKeyCache();
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
    cacheKey(WALLET_ID, created.jwk, wallet.address);
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

describe("TransferHandler: submitTransfer", () => {
  let storage: StoragePort;
  let wallet: Wallet;

  beforeEach(async () => {
    storage = createFakeStorage();
    const created = await createTestWallet();
    wallet = created.wallet;
    await storage.set("local:wallets", [wallet]);
    cacheKey(WALLET_ID, created.jwk, wallet.address);
  });

  it("throws a named error when no active HyperBEAM peer is configured for an AO transfer", async () => {
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [],
      activePeerUrl: null,
    });
    const handler = new TransferHandler(storage);
    await expect(
      handler.submitTransfer({
        walletId: WALLET_ID,
        recipient: "someAoRecipient",
        token: AO_PROCESS_ID,
        amount: "1",
        fee: null,
      }),
    ).rejects.toThrow(/active HyperBEAM peer/);
  });

  it("submits an AO transfer via aoconnect and writes an optimistic pending activity entry tagged with the token processId", async () => {
    await storage.set("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [],
      activePeerUrl: "https://hyperbeam.example.com",
    });
    aoMessageMock.mockResolvedValue("ao-msg-id-1");

    const handler = new TransferHandler(storage);
    const result = await handler.submitTransfer({
      walletId: WALLET_ID,
      recipient: "recipientAoAddr",
      token: AO_PROCESS_ID,
      amount: "42",
      fee: null,
    });

    expect(result.txId).toBe("ao-msg-id-1");
    expect(aoMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        process: AO_PROCESS_ID,
        tags: [
          { name: "Action", value: "Transfer" },
          { name: "Recipient", value: "recipientAoAddr" },
          { name: "Quantity", value: "42" },
        ],
      }),
    );

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
    aoMessageMock.mockResolvedValue("ao-msg-id-2");
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

  it("throws when the wallet isn't unlocked (no cached signing key)", async () => {
    clearKeyCache();
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
