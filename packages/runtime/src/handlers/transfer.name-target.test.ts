import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAddress, type StoragePort, type Wallet } from "@gleam/core";
import { generateJWK, Keyring } from "@gleam/core/signer";
import { base64UrlToBytes } from "@gleam/core/src/vault/base64.ts";
import { TransferHandler } from "./transfer";
import { createKeySession } from "./key-session";

const keySessionStore = new Map<string, unknown>();

const keySession = createKeySession({
  sessionKeys: new Keyring(),
  storage: {
    async get<T>(key: string) {
      return keySessionStore.has(key) ? (keySessionStore.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      keySessionStore.set(key, value);
    },
    async setMany(entries: Record<string, unknown>) {
      for (const [key, value] of Object.entries(entries)) keySessionStore.set(key, value);
    },
    async remove(key: string) {
      keySessionStore.delete(key);
    },
    watch() {
      return () => {};
    },
  },
});
const { cacheKey, clearKeyCache } = keySession;

function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
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
}

const WALLET_ID = "wallet-1";
const CARRIER = "cArRiEr_PrOcEsS-0123456789abcdefghijklmnopq";
const TARGET = "tArGeT_MaNiFeSt-0123456789abcdefghijklmnopq";
const REWARD = "654321";
const decoder = new TextDecoder();

let storage: StoragePort;
let wallet: Wallet;
let ownerB64Url: string;

type Holding = "held" | "listed" | "other";

/** A gateway with `balance` winston, serving the carrier's state for `holding`; records each POSTed transaction. */
function stubGateway(balance: string, holding: Holding = "held"): Array<Record<string, unknown>> {
  const posted: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes(`/${CARRIER}~process@1.0/now`)) {
      const holder = holding === "other" ? TARGET : wallet.address;
      return Response.json({
        "execution-device": "carrier@1.0",
        balances: holding === "held" || holding === "other" ? { [holder]: "1" } : {},
        orders: holding === "listed" ? { a: { creator: wallet.address, quantity: "1", status: "open" } } : {},
      });
    }
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

const FEE = (BigInt(REWARD) + 1n).toString();
const REQUEST = () => ({ walletId: WALLET_ID, carrier: CARRIER, label: "alice", target: TARGET, fee: FEE });

describe("TransferHandler: estimateNameTarget", () => {
  it("quotes the reward plus the 1 winston a set carries", async () => {
    stubGateway("1000000000");
    await expect(
      new TransferHandler(storage, keySession).estimateNameTarget({ walletId: WALLET_ID, carrier: CARRIER, label: "alice", target: TARGET }),
    ).resolves.toEqual({ fee: FEE });
  });

  it("fails when the wallet's AR can't cover it", async () => {
    stubGateway("10");
    await expect(
      new TransferHandler(storage, keySession).estimateNameTarget({ walletId: WALLET_ID, carrier: CARRIER, label: "alice", target: TARGET }),
    ).rejects.toThrow(/You need at least 0.000000654322 AR/);
  });
});

describe("TransferHandler: setNameTarget", () => {
  it("posts exactly the set: 1 winston to the carrier, no data, the two tags, the approved reward", async () => {
    const posted = stubGateway("1000000000");
    const setCachedNameTarget = vi.fn(async () => {});
    const handler = new TransferHandler(storage, keySession, undefined, { forgetCollectible: vi.fn(), setCachedNameTarget });

    const { txId } = await handler.setNameTarget(REQUEST());

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ id: txId, target: CARRIER, quantity: "1", data: "", data_size: "0", reward: REWARD });
    expect(plainTags(posted[0]?.tags)).toEqual([
      { name: "action", value: "set" },
      { name: "reference-value", value: TARGET },
    ]);
    expect(setCachedNameTarget).toHaveBeenCalledWith({ address: wallet.address, id: CARRIER, target: TARGET });
  });

  for (const holding of ["listed", "other"] as const) {
    it(`signs nothing when the live state shows the name ${holding === "listed" ? "listed for sale" : "held by someone else"}`, async () => {
      const posted = stubGateway("1000000000", holding);
      await expect(new TransferHandler(storage, keySession).setNameTarget(REQUEST())).rejects.toThrow(
        "This wallet no longer holds this name.",
      );
      expect(posted).toHaveLength(0);
    });
  }

  it("refuses a target that isn't an Arweave id", async () => {
    const posted = stubGateway("1000000000");
    await expect(new TransferHandler(storage, keySession).setNameTarget({ ...REQUEST(), target: "not-an-id" })).rejects.toThrow(
      /isn't an Arweave id/,
    );
    expect(posted).toHaveLength(0);
  });

  it("refuses a missing fee rather than letting the gateway set one", async () => {
    const posted = stubGateway("1000000000");
    await expect(new TransferHandler(storage, keySession).setNameTarget({ ...REQUEST(), fee: null })).rejects.toThrow();
    expect(posted).toHaveLength(0);
  });

  it("hands a hardware wallet's change to the approval window", async () => {
    keySessionStore.set("local:wallets", [{ ...wallet, method: "ledger", device: { kind: "ledger" } }]);
    const requestNameTarget = vi.fn(async () => ({ txId: "device-tx" }));
    const handler = new TransferHandler(storage, keySession, { requestTransfer: vi.fn(), requestNameTarget });

    await expect(handler.setNameTarget(REQUEST())).resolves.toEqual({ txId: "device-tx" });
    expect(requestNameTarget).toHaveBeenCalledWith(REQUEST());
  });

  it("builds the same set for a device to sign", async () => {
    stubGateway("1000000000");
    const payload = await new TransferHandler(storage, keySession).prepareDeviceNameTarget(REQUEST(), ownerB64Url);
    expect(payload.transaction).toMatchObject({ target: CARRIER, quantity: "1", reward: REWARD, data: "" });
  });
});
