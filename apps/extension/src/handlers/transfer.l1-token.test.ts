import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAddress, generateJWK, type StoragePort, type Wallet } from "@gleam/core";
import { base64UrlToBytes } from "@gleam/core/src/vault/base64.ts";
import { TransferHandler } from "./transfer";
import { cacheKey, clearKeyCache } from "./key-session";

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
const PID = "EuEkh8ZYkoPKXimgjre7W268XXX_qRn5vofc66oRTOw";
const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";
const REWARD = "654321";
const decoder = new TextDecoder();

let storage: StoragePort;
let wallet: Wallet;

/** A gateway with `balance` winston for every wallet; records each POSTed transaction. */
function stubGateway(balance: string): Array<Record<string, unknown>> {
  const posted: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/graphql")) return Response.json({ data: { transactions: { edges: [] } } });
    if (url.includes("tx_anchor")) return new Response("b".repeat(64));
    if (url.includes("/price/")) return new Response(REWARD);
    if (url.includes("/balance")) return new Response(balance);
    if (url.endsWith("/tx") && init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response("OK");
    }
    return new Response("not found", { status: 404 });
  });
  return posted;
}

function plainTags(tags: unknown): Array<{ name: string; value: string }> {
  return (tags as Array<{ name: string; value: string }>).map((tag) => ({
    name: decoder.decode(base64UrlToBytes(tag.name)),
    value: decoder.decode(base64UrlToBytes(tag.value)),
  }));
}

beforeEach(async () => {
  keySessionStore.clear();
  keySessionStore.set("session:unlockedSession", {
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
    autoLockTimeout: "never",
    unlockedWalletIds: [WALLET_ID],
  });
  const jwk = await generateJWK();
  wallet = {
    id: WALLET_ID,
    address: await deriveAddress(jwk),
    name: "Test wallet",
    method: "jwk",
    publicKey: jwk.n,
    createdAt: 0,
    updatedAt: 0,
    backupConfirmedAt: null,
    encryptedKeyfile: null,
  };
  storage = createFakeStorage();
  await storage.set("local:wallets", [wallet]);
  await cacheKey(WALLET_ID, jwk, wallet.address);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clearKeyCache();
});

const l1Routes = { tokenTransport: async () => "l1" as const };
const muRoutes = { tokenTransport: async () => "mu" as const };

describe("TransferHandler: arweave-scheduler token sends", () => {
  it("quotes the AR reward of the L1 transaction instead of claiming no fee", async () => {
    stubGateway("1000000000");
    const estimate = await new TransferHandler(storage, undefined, undefined, l1Routes).estimateTransfer({
      walletId: WALLET_ID,
      recipient: RECIPIENT,
      token: PID,
      amount: "311",
      fee: null,
    });
    expect(estimate.fee).toBe(REWARD);
  });

  it("posts a zero-AR L1 transaction to the token process with the transfer in lowercase tags", async () => {
    const posted = stubGateway("1000000000");
    const { txId } = await new TransferHandler(storage, undefined, undefined, l1Routes).submitTransfer({
      walletId: WALLET_ID,
      recipient: RECIPIENT,
      token: PID,
      amount: "311",
      fee: null,
    });

    expect(posted).toHaveLength(1);
    const [tx] = posted;
    expect(tx?.target).toBe(PID);
    expect(tx?.quantity).toBe("0");
    expect(plainTags(tx?.tags)).toEqual([
      { name: "action", value: "transfer" },
      { name: "recipient", value: RECIPIENT },
      { name: "quantity", value: "311" },
    ]);
    const log = await storage.get<Array<Record<string, unknown>>>(`local:activityLog:${wallet.address}`);
    expect(log?.[0]).toMatchObject({ txId, type: "send", token: PID, amount: "311", status: "pending" });
  });

  it("fails before signing when the wallet's AR can't pay the reward", async () => {
    const posted = stubGateway("10");
    await expect(
      new TransferHandler(storage, undefined, undefined, l1Routes).submitTransfer({
        walletId: WALLET_ID,
        recipient: RECIPIENT,
        token: PID,
        amount: "311",
        fee: null,
      }),
    ).rejects.toThrow(/network fee/);
    expect(posted).toHaveLength(0);
  });

  it("keeps a legacy token's send on the MU", async () => {
    stubGateway("1000000000");
    const estimate = await new TransferHandler(storage, undefined, undefined, muRoutes).estimateTransfer({
      walletId: WALLET_ID,
      recipient: RECIPIENT,
      token: PID,
      amount: "311",
      fee: null,
    });
    expect(estimate.fee).toBeNull();
  });
});
