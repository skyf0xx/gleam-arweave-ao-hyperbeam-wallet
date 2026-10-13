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
const ASSET = "aSsEt_PrOcEsS-0123456789abcdefghijklmnopqrs";
const RECIPIENT = "rEcIpIeNt_AdDrEsS-0123456789abcdefghijklmno";
const REWARD = "654321";
const COLLECTIBLE = { id: ASSET, name: "Beam #1", imageUrl: `https://arweave.net/${ASSET}` };
const decoder = new TextDecoder();

let storage: StoragePort;
let wallet: Wallet;
let ownerB64Url: string;

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
  ownerB64Url = jwk.n;
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

describe("TransferHandler: estimateCollectibleSend", () => {
  it("quotes the AR reward for a transaction to the asset process", async () => {
    stubGateway("1000000000");
    const estimate = await new TransferHandler(storage).estimateCollectibleSend({
      walletId: WALLET_ID,
      recipient: RECIPIENT,
      collectible: COLLECTIBLE,
    });
    expect(estimate).toEqual({ fee: REWARD, firstSeenRecipient: true });
  });

  it("fails with the fee in AR when the wallet's AR can't cover it", async () => {
    stubGateway("10");
    await expect(
      new TransferHandler(storage).estimateCollectibleSend({ walletId: WALLET_ID, recipient: RECIPIENT, collectible: COLLECTIBLE }),
    ).rejects.toThrow("Sending needs about 0.000000654321 AR for the network fee.");
  });

  it("refuses to send to the wallet's own address", async () => {
    stubGateway("1000000000");
    await expect(
      new TransferHandler(storage).estimateCollectibleSend({ walletId: WALLET_ID, recipient: wallet.address, collectible: COLLECTIBLE }),
    ).rejects.toThrow(/this wallet's own address/);
  });
});

describe("TransferHandler: collectible send validation", () => {
  const cases = [
    { label: "the collectible's own process id", recipient: ASSET, assetId: ASSET, error: "That's the collectible's own address. Enter the recipient's wallet address." },
    { label: "a malformed recipient", recipient: "not-an-address", assetId: ASSET, error: /full Arweave address/ },
    { label: "a malformed asset id", recipient: RECIPIENT, assetId: "bad-id", error: /process id isn't a valid Arweave id/ },
  ];

  for (const { label, recipient, assetId, error } of cases) {
    it(`refuses ${label} in both estimate and send, before any network call`, async () => {
      const posted = stubGateway("1000000000");
      const handler = new TransferHandler(storage);
      const req = { walletId: WALLET_ID, recipient, collectible: { ...COLLECTIBLE, id: assetId } };

      await expect(handler.estimateCollectibleSend(req)).rejects.toThrow(error);
      await expect(handler.sendCollectible(req)).rejects.toThrow(error);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(posted).toHaveLength(0);
    });
  }

  it("refuses a self-send in the estimate before any network call", async () => {
    stubGateway("1000000000");
    await expect(
      new TransferHandler(storage).estimateCollectibleSend({ walletId: WALLET_ID, recipient: wallet.address, collectible: COLLECTIBLE }),
    ).rejects.toThrow(/this wallet's own address/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("TransferHandler: sendCollectible", () => {
  it("posts an L1 transaction to the asset with zero AR, no data and the transfer tags", async () => {
    const posted = stubGateway("1000000000");
    const forgetCollectible = vi.fn(async () => {});
    const handler = new TransferHandler(storage, undefined, { forgetCollectible });

    const { txId } = await handler.sendCollectible({ walletId: WALLET_ID, recipient: RECIPIENT, collectible: COLLECTIBLE });

    expect(posted).toHaveLength(1);
    const [tx] = posted;
    expect(tx).toMatchObject({ id: txId, target: ASSET, quantity: "0", data: "", data_size: "0", reward: REWARD });
    expect(plainTags(tx?.tags)).toEqual([
      { name: "action", value: "transfer" },
      { name: "recipient", value: RECIPIENT },
      { name: "quantity", value: "1" },
    ]);
    expect(forgetCollectible).toHaveBeenCalledWith({ address: wallet.address, id: ASSET });
  });

  it("writes a pending activity entry that carries the collectible instead of an amount", async () => {
    stubGateway("1000000000");
    const { txId } = await new TransferHandler(storage).sendCollectible({
      walletId: WALLET_ID,
      recipient: RECIPIENT,
      collectible: COLLECTIBLE,
    });

    const [entry] = (await storage.get<Array<Record<string, unknown>>>(`local:activityLog:${wallet.address}`)) ?? [];
    expect(entry).toMatchObject({
      txId,
      type: "send",
      status: "pending",
      address: RECIPIENT,
      amount: null,
      token: null,
      collectible: COLLECTIBLE,
    });
  });

  it("signs nothing when the wallet's AR can't pay the reward", async () => {
    const posted = stubGateway("10");
    await expect(
      new TransferHandler(storage).sendCollectible({ walletId: WALLET_ID, recipient: RECIPIENT, collectible: COLLECTIBLE }),
    ).rejects.toThrow(/Sending needs about .* AR for the network fee/);
    expect(posted).toHaveLength(0);
    expect(await storage.get(`local:activityLog:${wallet.address}`)).toBeNull();
  });

  it("refuses a send to the wallet's own address", async () => {
    const posted = stubGateway("1000000000");
    await expect(
      new TransferHandler(storage).sendCollectible({ walletId: WALLET_ID, recipient: wallet.address, collectible: COLLECTIBLE }),
    ).rejects.toThrow(/this wallet's own address/);
    expect(posted).toHaveLength(0);
  });

  it("hands a hardware wallet's send to the approval window with the collectible", async () => {
    keySessionStore.set("local:wallets", [{ ...wallet, method: "ledger" }]);
    const requestTransfer = vi.fn(async () => ({ txId: "device-tx" }));
    const handler = new TransferHandler(storage, { requestTransfer });

    await expect(
      handler.sendCollectible({ walletId: WALLET_ID, recipient: RECIPIENT, collectible: COLLECTIBLE }),
    ).resolves.toEqual({ txId: "device-tx" });
    expect(requestTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: RECIPIENT, token: null, amount: "0", collectible: COLLECTIBLE }),
    );
  });

  it("builds the same transaction for a device to sign", async () => {
    stubGateway("1000000000");
    const payload = await new TransferHandler(storage).prepareDeviceTransfer(
      { walletId: WALLET_ID, recipient: RECIPIENT, token: null, amount: "0", fee: null, collectible: COLLECTIBLE },
      ownerB64Url,
    );
    expect(payload.kind).toBe("transaction");
    if (payload.kind !== "transaction") return;
    expect(payload.transaction).toMatchObject({ target: ASSET, quantity: "0", data: "", reward: REWARD });
    expect(plainTags(payload.transaction.tags)).toEqual([
      { name: "action", value: "transfer" },
      { name: "recipient", value: RECIPIENT },
      { name: "quantity", value: "1" },
    ]);
  });
});
