import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addressFromOwner, type ApprovalPresenterPort, type UnsignedPayload } from "@gleam/core";
import { generateJWK, Keyring } from "@gleam/core/signer";
import { InMemoryStorage } from "../../testing";
import { ApprovalHandler } from "./approval";
import type { SigningRequestInput } from "./approval-types";
import { createKeySession } from "./key-session";

/**
 * Lets a test alter what each builder returns, as a builder regression
 * would. A keyfile wallet must refuse to sign it, as a hardware wallet does.
 */
const { tamper } = vi.hoisted(() => ({
  tamper: {
    transaction: null as null | ((transaction: Record<string, unknown>) => Record<string, unknown>),
    dispatch: null as null | ((payload: UnsignedPayload) => UnsignedPayload),
    dataItem: null as null | ((raw: Uint8Array) => Uint8Array),
  },
}));

vi.mock("@gleam/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gleam/core")>();
  return {
    ...actual,
    prepareSignTransaction: async (...args: Parameters<typeof actual.prepareSignTransaction>) => {
      const transaction = await actual.prepareSignTransaction(...args);
      return tamper.transaction ? tamper.transaction(transaction as never) : transaction;
    },
    prepareDispatch: async (...args: Parameters<typeof actual.prepareDispatch>) => {
      const payload = await actual.prepareDispatch(...args);
      return tamper.dispatch ? tamper.dispatch(payload) : payload;
    },
    prepareDataItem: (...args: Parameters<typeof actual.prepareDataItem>) => {
      const raw = actual.prepareDataItem(...args);
      return tamper.dataItem ? tamper.dataItem(raw) : raw;
    },
    prepareDataItems: (...args: Parameters<typeof actual.prepareDataItems>) => {
      const raws = actual.prepareDataItems(...args);
      return tamper.dataItem ? raws.map((raw) => tamper.dataItem!(raw)) : raws;
    },
  };
});

const WALLET_ID = "wallet-1";
const ORIGIN = "https://bazar.arweave.net";
const GATEWAY = "https://arweave.net";
const RECIPIENT = "r".repeat(43);

const sessionStore = new InMemoryStorage();
const keySession = createKeySession({ sessionKeys: new Keyring(), storage: sessionStore });

function recordingPresenter(): ApprovalPresenterPort & { presented: string[] } {
  const presented: string[] = [];
  return {
    presented,
    async present(requestId) {
      presented.push(requestId);
    },
    async dismiss() {},
    async focus() {},
    onDismissed() {
      return () => {};
    },
  };
}

/** The data item's last byte flipped: its data no longer matches the request. */
function flipLastByte(raw: Uint8Array): Uint8Array {
  const copy = raw.slice();
  copy[copy.length - 1] = copy[copy.length - 1]! ^ 1;
  return copy;
}

let storage: InMemoryStorage;
let presenter: ReturnType<typeof recordingPresenter>;
let handler: ApprovalHandler;

beforeEach(async () => {
  sessionStore.entries.clear();
  const jwk = await generateJWK();
  const address = await addressFromOwner(jwk.n);
  sessionStore.entries.set("session:unlockedSession", {
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
    autoLockTimeout: "never",
    unlockedWalletIds: [WALLET_ID],
  });
  sessionStore.entries.set("local:wallets", [{ id: WALLET_ID, method: "jwk", address, publicKey: jwk.n }]);
  await keySession.cacheKey(WALLET_ID, jwk, address);
  storage = new InMemoryStorage();
  await storage.set("local:wallets", [{ id: WALLET_ID, method: "jwk", address, publicKey: jwk.n, name: "Main" }]);
  await storage.set("local:grants", [
    { origin: ORIGIN, walletId: WALLET_ID, permissions: ["ACCESS_ADDRESS", "SIGNATURE"], createdAt: 0, expiresAt: null, budget: null },
  ]);
  presenter = recordingPresenter();
  handler = new ApprovalHandler(storage, keySession, presenter, undefined, "https://bundler.example");
});

afterEach(async () => {
  tamper.transaction = null;
  tamper.dispatch = null;
  tamper.dataItem = null;
  await keySession.clearKeyCache();
  vi.restoreAllMocks();
});

const SIGN: SigningRequestInput = {
  kind: "sign",
  payload: new TextEncoder().encode("hello"),
  tags: [{ name: "App-Name", value: "Gleam" }],
  gatewayUrl: GATEWAY,
  target: RECIPIENT,
  quantity: "10",
  reward: "5000",
  last_tx: "b".repeat(64),
};

const DATA_ITEMS = [{ data: btoa("hello"), tags: [{ name: "Action", value: "Eval" }] }];

async function approve(input: SigningRequestInput): Promise<unknown> {
  const pending = handler.requestApproval({ origin: ORIGIN, walletId: WALLET_ID, ...input });
  pending.catch(() => {});
  await vi.waitFor(() => expect(presenter.presented.length).toBe(1));
  await handler.resolveApproval({ requestId: presenter.presented[0]!, approved: true }).catch(() => {});
  return pending;
}

describe("ApprovalHandler: a keyfile wallet signs only what the request approved", () => {
  it("signs an untampered request of each kind", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "ok" }), { status: 200 }));
    await expect(approve(SIGN)).resolves.toMatchObject({ target: RECIPIENT, quantity: "10" });
    presenter.presented.length = 0;
    await expect(approve({ ...SIGN, kind: "dispatch" })).resolves.toMatchObject({ type: "BASE" });
    presenter.presented.length = 0;
    await expect(approve({ kind: "signDataItem", payload: new Uint8Array(), dataItems: DATA_ITEMS })).resolves.toBeInstanceOf(
      ArrayBuffer,
    );
    presenter.presented.length = 0;
    await expect(
      approve({ kind: "batchSignDataItem", payload: new Uint8Array(), dataItems: [...DATA_ITEMS, ...DATA_ITEMS] }),
    ).resolves.toHaveLength(2);
  });

  it.each([
    ["recipient", (transaction: Record<string, unknown>) => ({ ...transaction, target: "x".repeat(43) })],
    ["amount", (transaction: Record<string, unknown>) => ({ ...transaction, quantity: "999999" })],
    ["tags", (transaction: Record<string, unknown>) => ({ ...transaction, tags: [] })],
    ["data", (transaction: Record<string, unknown>) => ({ ...transaction, data: "" })],
    ["fee", (transaction: Record<string, unknown>) => ({ ...transaction, reward: "1" })],
  ])("sign: refuses a prepared transaction whose %s differs", async (field, alter) => {
    tamper.transaction = alter;
    await expect(approve(SIGN)).rejects.toThrow(`prepared ${field} doesn't match`);
  });

  it("dispatch: refuses a prepared transaction that differs, and posts nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    tamper.dispatch = (payload) =>
      payload.kind === "transaction" ? { ...payload, transaction: { ...payload.transaction, target: "x".repeat(43) } } : payload;
    await expect(approve({ ...SIGN, kind: "dispatch" })).rejects.toThrow("prepared recipient doesn't match");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatch: refuses a prepared data item that differs, and posts nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    tamper.dispatch = (payload) => (payload.kind === "dataItem" ? { ...payload, raw: flipLastByte(payload.raw) as never } : payload);
    await expect(
      approve({ kind: "dispatch", payload: new Uint8Array(150 * 1024).fill(1), gatewayUrl: GATEWAY }),
    ).rejects.toThrow("prepared data doesn't match");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("signDataItem: refuses a prepared item that differs", async () => {
    tamper.dataItem = flipLastByte;
    await expect(approve({ kind: "signDataItem", payload: new Uint8Array(), dataItems: DATA_ITEMS })).rejects.toThrow(
      "prepared data doesn't match",
    );
  });

  it("batchSignDataItem: refuses prepared items that differ", async () => {
    tamper.dataItem = flipLastByte;
    await expect(
      approve({ kind: "batchSignDataItem", payload: new Uint8Array(), dataItems: [...DATA_ITEMS, ...DATA_ITEMS] }),
    ).rejects.toThrow("prepared data doesn't match");
  });

  it("signs as the unlocked wallet's owner", async () => {
    const [wallet] = (await storage.get<Array<{ publicKey: string }>>("local:wallets"))!;
    const signed = (await approve(SIGN)) as { owner: string };
    expect(signed.owner).toBe(wallet!.publicKey);
  });
});
