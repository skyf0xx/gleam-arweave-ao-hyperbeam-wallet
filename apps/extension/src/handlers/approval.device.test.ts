import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addressFromOwner,
  base64UrlToBytes,
  bytesToBase64Url,
  signPayloadWithSigner,
  verifyMessage,
  WALLET_APPROVAL_ORIGIN,
  type ApprovalRequest,
  type DeviceSigningPayload,
  type DeviceSigningRequest,
  type JWKInterface,
  type StoragePort,
  type WindowPort,
} from "@gleam/core";
import { signerFromJwk, generateJWK } from "@gleam/core/signer";
import { dataItemSignatureData } from "@gleam/core/src/arweave/data-item.ts";
import { signRsaPss } from "@gleam/core/src/arweave/rsa-pss.ts";
import { verifyPointsProof } from "@gleam/core/src/points/index.ts";
import { ApprovalHandler, type SigningRequestInput } from "./approval";
import { TransferHandler } from "./transfer";

const keySessionStore = new Map<string, unknown>();

/** Lets a test alter what the transaction builder returns, as a misbehaving gateway or library could. */
const { tamper } = vi.hoisted(() => ({
  tamper: { transaction: null as null | ((transaction: Record<string, unknown>) => Record<string, unknown>) },
}));

vi.mock("@gleam/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gleam/core")>();
  return {
    ...actual,
    prepareSignTransaction: async (...args: Parameters<typeof actual.prepareSignTransaction>) => {
      const transaction = await actual.prepareSignTransaction(...args);
      return tamper.transaction ? tamper.transaction(transaction as never) : transaction;
    },
  };
});

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

function createWatchableStorage(): StoragePort {
  const store = new Map<string, unknown>();
  const watchers = new Map<string, Set<(value: unknown) => void>>();
  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      const stored: unknown = JSON.parse(JSON.stringify(value));
      store.set(key, stored);
      for (const cb of watchers.get(key) ?? []) cb(stored);
    },
    async remove(key: string) {
      store.delete(key);
      for (const cb of watchers.get(key) ?? []) cb(null);
    },
    watch<T>(key: string, cb: (value: T | null) => void) {
      const set = watchers.get(key) ?? new Set();
      set.add(cb as (value: unknown) => void);
      watchers.set(key, set);
      return () => {
        watchers.get(key)?.delete(cb as (value: unknown) => void);
      };
    },
  };
}

function createFakeWindows(): WindowPort & { opened: string[]; closed: string[]; userCloses(requestId: string): void } {
  const opened: string[] = [];
  const closed: string[] = [];
  const listeners = new Set<(requestId: string) => void>();
  return {
    opened,
    closed,
    async createApprovalWindow(url: string) {
      opened.push(url);
    },
    async closeApprovalWindow(requestId: string) {
      closed.push(requestId);
    },
    async focusApprovalWindow() {},
    onApprovalWindowClosed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    userCloses(requestId: string) {
      for (const listener of listeners) listener(requestId);
    },
  };
}

function requestIdOf(url: string): string {
  return decodeURIComponent(/requestId=([^&]+)/.exec(url)![1]!);
}

const HW_ID = "hw-1";
const ORIGIN = "https://bazar.arweave.net";
const GATEWAY = "https://arweave.net";
const RECIPIENT = "r".repeat(43);
const PROCESS_ID = bytesToBase64Url(new Uint8Array(32).fill(7));

function unsignedOf(payload: DeviceSigningPayload) {
  switch (payload.kind) {
    case "transaction":
      return payload;
    case "dataItem":
      return { kind: "dataItem" as const, raw: base64UrlToBytes(payload.raw) };
    case "message":
      return { kind: "message" as const, data: base64UrlToBytes(payload.data) };
  }
}

/** Stands in for the device: signs each payload the window was handed. */
async function deviceSign(device: DeviceSigningRequest, jwk: JWKInterface): Promise<string[]> {
  return Promise.all(
    device.payloads.map(async (payload) => bytesToBase64Url(await signPayloadWithSigner(unsignedOf(payload), signerFromJwk(jwk, "")))),
  );
}

const originalFetch = globalThis.fetch;

/** A gateway, bundler and MU that accept everything. */
function mockNetwork(): string[] {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/tx_anchor")) return new Response("b".repeat(64));
    if (url.includes("/price/")) return new Response("1000");
    return new Response(JSON.stringify({ id: "accepted" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

let storage: StoragePort;
let windows: ReturnType<typeof createFakeWindows>;
let transfer: TransferHandler;
let handler: ApprovalHandler;
let deviceKey: JWKInterface;
let address: string;

beforeEach(async () => {
  keySessionStore.clear();
  deviceKey = await generateJWK();
  address = await addressFromOwner(deviceKey.n);
  const wallet = {
    id: HW_ID,
    address,
    name: "Keystone",
    method: "keystone",
    publicKey: deviceKey.n,
    createdAt: 0,
    updatedAt: 0,
    backupConfirmedAt: null,
    encryptedKeyfile: null,
    device: { kind: "keystone", xfp: "12345678" },
  };
  keySessionStore.set("local:wallets", [wallet]);
  storage = createWatchableStorage();
  await storage.set("local:wallets", [wallet]);
  windows = createFakeWindows();
  transfer = new TransferHandler(storage, { requestTransfer: (req) => handler.requestWalletTransfer(req) });
  handler = new ApprovalHandler(storage, windows, transfer, "https://bundler.example");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  tamper.transaction = null;
  vi.useRealTimers();
});


/** Opens a request and approves its preview; resolves with the awaiting-device view. */
async function approveOnDevice(input: SigningRequestInput | (() => Promise<unknown>)) {
  const pending =
    typeof input === "function" ? input() : handler.requestApproval({ origin: ORIGIN, walletId: HW_ID, ...input });
  pending.catch(() => {});
  await vi.waitFor(() => expect(windows.opened.length).toBe(1));
  const requestId = requestIdOf(windows.opened[0]!);
  const view = (await handler.resolveApproval({ requestId, approved: true })) as ApprovalRequest;
  return { pending, requestId, view, device: view.device! };
}

describe("ApprovalHandler: hardware wallet requests wait for the device", () => {
  it("sign: approving builds the unsigned transaction, and the device's signature completes it", async () => {
    const { pending, requestId, device } = await approveOnDevice({
      kind: "sign",
      payload: new TextEncoder().encode("hello"),
      gatewayUrl: GATEWAY,
      target: RECIPIENT,
      quantity: "10",
      reward: "5000",
      last_tx: "b".repeat(64),
    });

    expect(device).toMatchObject({
      method: "keystone",
      device: { kind: "keystone", xfp: "12345678" },
      address,
      publicKey: deviceKey.n,
    });
    expect(device.payloads).toHaveLength(1);
    expect(device.payloads[0]).toMatchObject({ kind: "transaction", transaction: { owner: deviceKey.n, signature: "" } });
    // Still pending, and a reopened window sees the same device step.
    expect((await handler.getApproval({ requestId })).device?.payloads).toEqual(device.payloads);
    expect(windows.closed).not.toContain(requestId);

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    await expect(pending).resolves.toMatchObject({ owner: deviceKey.n, target: RECIPIENT, quantity: "10" });
    expect(windows.closed).toContain(requestId);
    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
  });

  it("dispatch: posts the device-signed transaction on L1", async () => {
    const calls = mockNetwork();
    const { pending, requestId, device } = await approveOnDevice({
      kind: "dispatch",
      payload: new TextEncoder().encode("hello"),
      gatewayUrl: GATEWAY,
      reward: "5000",
      last_tx: "b".repeat(64),
    });

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    await expect(pending).resolves.toMatchObject({ type: "BASE" });
    expect(calls).toContain(`POST ${GATEWAY}:443/tx`);
  });

  it("dispatch: a Ledger signs a payload large enough to bundle as an L1 transaction", async () => {
    const wallets = (keySessionStore.get("local:wallets") as Record<string, unknown>[]).map((wallet) => ({
      ...wallet,
      name: "Ledger",
      method: "ledger",
      device: { kind: "ledger" },
    }));
    keySessionStore.set("local:wallets", wallets);
    await storage.set("local:wallets", wallets);
    const calls = mockNetwork();
    const { pending, requestId, device } = await approveOnDevice({
      kind: "dispatch",
      payload: new Uint8Array(150 * 1024).fill(1),
      gatewayUrl: GATEWAY,
      reward: "5000",
      last_tx: "b".repeat(64),
    });
    expect(device.method).toBe("ledger");
    expect(device.payloads.map((payload) => payload.kind)).toEqual(["transaction"]);

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    await expect(pending).resolves.toMatchObject({ type: "BASE" });
    expect(calls.some((call) => call.includes("bundler.example"))).toBe(false);
  });

  it("signDataItem: resolves to the raw signed item", async () => {
    const { pending, requestId, device } = await approveOnDevice({
      kind: "signDataItem",
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello"), tags: [{ name: "Action", value: "Eval" }] }],
    });
    expect(device.payloads).toEqual([{ kind: "dataItem", raw: expect.any(String) }]);

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    const raw = (await pending) as ArrayBuffer;
    expect(Object.prototype.toString.call(raw)).toBe("[object ArrayBuffer]");
    expect(new TextDecoder().decode(new Uint8Array(raw).slice(-5))).toBe("hello");
  });

  it("batchSignDataItem: needs one signature per item, and resolves to every item in order", async () => {
    const { pending, requestId, device } = await approveOnDevice({
      kind: "batchSignDataItem",
      payload: new TextEncoder().encode("first"),
      dataItems: [{ data: btoa("first") }, { data: btoa("second") }],
    });
    expect(device.payloads).toHaveLength(2);
    const signatures = await deviceSign(device, deviceKey);

    await expect(handler.submitDeviceSignature({ requestId, signatures: signatures.slice(0, 1) })).rejects.toThrow(
      /Expected 2 signature/,
    );
    await handler.submitDeviceSignature({ requestId, signatures });

    const raws = (await pending) as ArrayBuffer[];
    expect(raws).toHaveLength(2);
    expect(new TextDecoder().decode(new Uint8Array(raws[0]!).slice(-5))).toBe("first");
    expect(new TextDecoder().decode(new Uint8Array(raws[1]!).slice(-6))).toBe("second");
  });

  it("a signature that doesn't verify is refused, the request keeps waiting, and a retry completes it", async () => {
    const { pending, requestId, device } = await approveOnDevice({
      kind: "signDataItem",
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });

    const garbage = bytesToBase64Url(new Uint8Array(512).fill(7));
    await expect(handler.submitDeviceSignature({ requestId, signatures: [garbage] })).rejects.toThrow(
      /doesn't match this wallet/,
    );
    expect((await handler.getApproval({ requestId })).device).toBeDefined();
    expect(windows.closed).not.toContain(requestId);

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });
    await expect(pending).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("a signature by another key is refused", async () => {
    const { requestId, device } = await approveOnDevice({
      kind: "signDataItem",
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });

    // Another account signing the very payload the window was handed.
    const otherKey = await generateJWK();
    const payload = device.payloads[0]!;
    if (payload.kind !== "dataItem") throw new Error("expected a data item");
    const message = await dataItemSignatureData(base64UrlToBytes(payload.raw));
    const signature = bytesToBase64Url(await signRsaPss(signerFromJwk(otherKey, ""), message));
    await expect(handler.submitDeviceSignature({ requestId, signatures: [signature] })).rejects.toThrow(
      /doesn't match this wallet/,
    );
    expect((await handler.getApproval({ requestId })).device).toBeDefined();
  });

  it("signMessage: resolves to a signature that passes verifyMessage", async () => {
    const message = new TextEncoder().encode("Sign in to example.com");
    const { pending, requestId, device } = await approveOnDevice({ kind: "signMessage", payload: message });
    expect(device.payloads).toEqual([{ kind: "message", data: bytesToBase64Url(message) }]);
    expect(device.summaries).toEqual([{ kind: "message", text: "Sign in to example.com", size: message.byteLength }]);

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    const signature = (await pending) as Uint8Array;
    expect(await verifyMessage(deviceKey.n, message.slice().buffer, signature.slice().buffer)).toBe(true);
  });

  it("signMessage: the device step shows only the size of a message with bidi overrides", async () => {
    const message = new TextEncoder().encode("pay \u202Eevil");
    const { device } = await approveOnDevice({ kind: "signMessage", payload: message });
    expect(device.summaries).toEqual([{ kind: "message", text: null, size: message.byteLength }]);
  });

  it("signMessage: a message signed without hashing it first is refused", async () => {
    const message = new TextEncoder().encode("hello");
    const { requestId, device } = await approveOnDevice({ kind: "signMessage", payload: message });
    // RSA-PSS straight over the bytes is one hash short of signMessage.
    const unhashed = await signRsaPss(signerFromJwk(deviceKey, ""), message);

    await expect(
      handler.submitDeviceSignature({ requestId, signatures: [bytesToBase64Url(unhashed)] }),
    ).rejects.toThrow(/doesn't match this wallet/);
    expect(device.payloads).toHaveLength(1);
  });

  it("signMessage: refuses a hash other than SHA-256", async () => {
    const pending = handler.requestApproval({
      kind: "signMessage",
      origin: ORIGIN,
      walletId: HW_ID,
      payload: new TextEncoder().encode("hello"),
      hashAlgorithm: "SHA-512",
    });
    const rejected = expect(pending).rejects.toThrow(/SHA-256 only, not SHA-512/);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    await expect(
      handler.resolveApproval({ requestId: requestIdOf(windows.opened[0]!), approved: true }),
    ).rejects.toThrow(/SHA-256 only/);
    await rejected;
  });

  it("refuses to start when the stored public key doesn't match the wallet's address", async () => {
    const otherKey = await generateJWK();
    const [wallet] = keySessionStore.get("local:wallets") as Array<Record<string, unknown>>;
    keySessionStore.set("local:wallets", [{ ...wallet, publicKey: otherKey.n }]);

    const pending = handler.requestApproval({
      kind: "signDataItem",
      origin: ORIGIN,
      walletId: HW_ID,
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });
    const rejected = expect(pending).rejects.toThrow(/doesn't match its address/);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    await expect(
      handler.resolveApproval({ requestId: requestIdOf(windows.opened[0]!), approved: true }),
    ).rejects.toThrow(/doesn't match its address/);
    await rejected;
  });

  it("cancelling while waiting for the device rejects the dApp", async () => {
    const { pending, requestId } = await approveOnDevice({
      kind: "signDataItem",
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });

    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/already approved/);
    await handler.resolveApproval({ requestId, approved: false });

    await expect(pending).rejects.toThrow(/rejected/);
    expect(windows.closed).toContain(requestId);
  });

  it("closing the window while waiting for the device rejects the dApp", async () => {
    const { pending, requestId } = await approveOnDevice({
      kind: "signDataItem",
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });

    windows.userCloses(requestId);

    await expect(pending).rejects.toThrow(/approval window was closed/);
  });

  it("submitDeviceSignature is refused for a request still in review", async () => {
    const pending = handler.requestApproval({
      kind: "signDataItem",
      origin: ORIGIN,
      walletId: HW_ID,
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });
    pending.catch(() => {});
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));

    await expect(
      handler.submitDeviceSignature({ requestId: requestIdOf(windows.opened[0]!), signatures: [] }),
    ).rejects.toThrow(/isn't waiting for a device signature/);
  });
});

describe("ApprovalHandler: device timeouts", () => {
  const MINUTE = 60_000;

  async function approveAfter(reviewMs: number) {
    vi.useFakeTimers();
    const pending = handler.requestApproval({
      kind: "signDataItem",
      origin: ORIGIN,
      walletId: HW_ID,
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });
    let settled: unknown = null;
    pending.then(
      () => (settled = "resolved"),
      (error: Error) => (settled = error),
    );
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = requestIdOf(windows.opened[0]!);
    await vi.advanceTimersByTimeAsync(reviewMs);
    await handler.resolveApproval({ requestId, approved: true });
    return { requestId, settled: () => settled };
  }

  it("entering the device step gives another five minutes past the review timeout", async () => {
    const { settled } = await approveAfter(4 * MINUTE);

    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(settled()).toBeNull();

    await vi.advanceTimersByTimeAsync(1 * MINUTE + 1);
    expect(settled()).toBeInstanceOf(Error);
    expect((settled() as Error).message).toMatch(/timed out/);
  });

  it("device activity keeps pushing the deadline back, up to fifteen minutes from the request", async () => {
    const { requestId, settled } = await approveAfter(4 * MINUTE);

    for (let minute = 0; minute < 10; minute += 1) {
      await vi.advanceTimersByTimeAsync(MINUTE);
      await handler.deviceActivity({ requestId });
    }
    // 14 minutes in.
    expect(settled()).toBeNull();
    const { deadline } = await handler.deviceActivity({ requestId });
    const createdAt = (await handler.getApproval({ requestId })).createdAt;
    expect(deadline).toBe(createdAt + 15 * MINUTE);

    await vi.advanceTimersByTimeAsync(MINUTE + 1);
    expect(settled()).toBeInstanceOf(Error);
    expect(windows.closed).toContain(requestId);
  });

  it("deviceActivity is refused for a request still in review", async () => {
    const pending = handler.requestApproval({
      kind: "signDataItem",
      origin: ORIGIN,
      walletId: HW_ID,
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });
    pending.catch(() => {});
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));

    await expect(handler.deviceActivity({ requestId: requestIdOf(windows.opened[0]!) })).rejects.toThrow(
      /isn't waiting for a device/,
    );
  });
});

describe("Transfers from a hardware wallet sign in the approval window", () => {
  async function activityLog(): Promise<Array<Record<string, unknown>>> {
    return ((await storage.get(`local:activityLog:${address}`)) as Array<Record<string, unknown>>) ?? [];
  }

  it("a popup AR send opens a Gleam request, posts the device-signed transaction, and logs it", async () => {
    const calls = mockNetwork();
    const { pending, view, requestId, device } = await approveOnDevice(() =>
      transfer.submitTransfer({ walletId: HW_ID, token: null, recipient: RECIPIENT, amount: "10", fee: "1000" }),
    );

    expect(view).toMatchObject({
      kind: "transfer",
      origin: WALLET_APPROVAL_ORIGIN,
      preview: { kind: "transfer", recipient: RECIPIENT, amount: "10", fee: "1000", token: null },
    });
    expect(device.payloads[0]).toMatchObject({
      kind: "transaction",
      transaction: { owner: deviceKey.n, target: RECIPIENT, quantity: "10" },
    });

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    const { txId } = (await pending) as { txId: string };
    expect(txId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls).toContain(`POST ${GATEWAY}:443/tx`);
    expect(await activityLog()).toEqual([
      expect.objectContaining({ txId, type: "send", status: "pending", address: RECIPIENT, amount: "10", token: null }),
    ]);
  });

  it("a popup collectible send has the device sign the L1 transfer to the asset and logs the collectible", async () => {
    const calls = mockNetwork();
    const network = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/balance") ? new Response("1000000") : network(input, init),
    ) as unknown as typeof fetch;
    const collectible = { id: PROCESS_ID, name: "Beam #1" };
    const { pending, view, requestId, device } = await approveOnDevice(() =>
      transfer.sendCollectible({ walletId: HW_ID, recipient: RECIPIENT, collectible }),
    );

    expect(view).toMatchObject({ kind: "transfer", preview: { recipient: RECIPIENT, amount: "0", collectible } });
    expect(device.payloads[0]).toMatchObject({ kind: "transaction", transaction: { target: PROCESS_ID, quantity: "0", data: "" } });
    expect(device.summaries[0]).toEqual({ kind: "collectibleTransfer", asset: PROCESS_ID, recipient: RECIPIENT, fee: "1000" });

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    const { txId } = (await pending) as { txId: string };
    expect(calls).toContain(`POST ${GATEWAY}:443/tx`);
    expect(await activityLog()).toEqual([
      expect.objectContaining({ txId, address: RECIPIENT, amount: null, token: null, collectible }),
    ]);
  });

  it("a popup AO send posts the device-signed Transfer to the MU and logs it", async () => {
    const calls = mockNetwork();
    const { pending, requestId, device } = await approveOnDevice(() =>
      transfer.submitTransfer({ walletId: HW_ID, token: PROCESS_ID, recipient: RECIPIENT, amount: "7", fee: null }),
    );
    expect(device.payloads[0]!.kind).toBe("dataItem");

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    const { txId } = (await pending) as { txId: string };
    expect(calls).toContain("POST https://mu.ao-testnet.xyz");
    expect(await activityLog()).toEqual([expect.objectContaining({ txId, token: PROCESS_ID, amount: "7" })]);
  });

  it("a dApp's transferAoTokens resolves to { id } and logs the send", async () => {
    mockNetwork();
    const { pending, requestId, device } = await approveOnDevice({
      kind: "transferAoTokens",
      recipient: RECIPIENT,
      amount: "3",
      fee: null,
      token: PROCESS_ID,
      payload: new Uint8Array(),
    });

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    const { id } = (await pending) as { id: string };
    expect(await activityLog()).toEqual([expect.objectContaining({ txId: id, token: PROCESS_ID })]);
  });

  it("a gateway refusing the device-signed transfer rejects the send and logs nothing", async () => {
    mockNetwork();
    const { pending, requestId, device } = await approveOnDevice(() =>
      transfer.submitTransfer({ walletId: HW_ID, token: PROCESS_ID, recipient: RECIPIENT, amount: "7", fee: null }),
    );
    const assertion = expect(pending).rejects.toThrow(/failed \(500\)/);
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;

    await expect(
      handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) }),
    ).rejects.toThrow(/failed \(500\)/);
    await assertion;
    expect(await activityLog()).toEqual([]);
  });
});

describe("Gleam Points ownership proofs sign in the approval window", () => {
  const MESSAGE = "gleam-points:leave:v1:" + "a".repeat(43) + ":1700000000";

  it("the device signs a 0-AR transaction carrying the message, and the proof verifies", async () => {
    const calls = mockNetwork();
    const { pending, view, requestId, device } = await approveOnDevice(() =>
      handler.requestPointsProof({ walletId: HW_ID, message: MESSAGE }),
    );

    expect(view).toMatchObject({ kind: "pointsProof", origin: WALLET_APPROVAL_ORIGIN, preview: { decodedData: MESSAGE } });
    expect(device.summaries).toEqual([{ kind: "transaction", recipient: address, quantity: "0", fee: "0", dataSize: "0" }]);

    await handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });

    const proof = (await pending) as { owner: string; address: string; signature: string };
    expect(proof).toMatchObject({ owner: deviceKey.n, address });
    expect(await verifyPointsProof("transaction", proof.owner, MESSAGE, proof.signature)).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("ApprovalHandler: device deadlines without the timer", () => {
  const MINUTE = 60_000;
  const DATA_ITEM = {
    kind: "signDataItem" as const,
    payload: new TextEncoder().encode("hello"),
    dataItems: [{ data: btoa("hello") }],
  };

  // Only Date is faked: no timer fires, as after the service worker was evicted.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  it("a signature submitted after the deadline is refused, rejects the dApp, and drops the request", async () => {
    const { pending, requestId, device } = await approveOnDevice(DATA_ITEM);
    const signatures = await deviceSign(device, deviceKey);
    vi.advanceTimersByTime(5 * MINUTE + 1);

    await expect(handler.submitDeviceSignature({ requestId, signatures })).rejects.toThrow(/timed out/);
    await expect(pending).rejects.toThrow(/timed out/);
    expect(windows.closed).toContain(requestId);
    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
  });

  it("device activity after the deadline is refused the same way", async () => {
    const { pending, requestId } = await approveOnDevice(DATA_ITEM);
    vi.advanceTimersByTime(5 * MINUTE + 1);

    await expect(handler.deviceActivity({ requestId })).rejects.toThrow(/timed out/);
    await expect(pending).rejects.toThrow(/timed out/);
  });

  it("records past their deadline are hidden when read and pruned on the next write", async () => {
    const { requestId } = await approveOnDevice(DATA_ITEM);
    vi.advanceTimersByTime(5 * MINUTE + 1);

    await expect(handler.getApproval({ requestId })).rejects.toThrow(/No pending approval/);
    handler.requestApproval({ ...DATA_ITEM, origin: ORIGIN, walletId: HW_ID }).catch(() => {});
    await vi.waitFor(async () => {
      const stored = (await storage.get("session:pendingApprovals")) as Array<{ request: { requestId: string } }>;
      expect(stored.map((entry) => entry.request.requestId)).not.toContain(requestId);
      expect(stored).toHaveLength(1);
    });
  });

  it("a request still in review is hidden once its review timeout has passed", async () => {
    handler.requestApproval({ ...DATA_ITEM, origin: ORIGIN, walletId: HW_ID }).catch(() => {});
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    const requestId = requestIdOf(windows.opened[0]!);
    vi.advanceTimersByTime(5 * MINUTE + 1);

    await expect(handler.resolveApproval({ requestId, approved: true })).rejects.toThrow(/No pending approval/);
  });
});

describe("ApprovalHandler: device races", () => {
  it("the timeout waits for a signature that is being posted", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const posted = new Promise<void>((resolve) => (release = resolve));
    globalThis.fetch = vi.fn(async () => {
      await posted;
      return new Response(JSON.stringify({ id: "accepted" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { pending, requestId, device } = await approveOnDevice({
      kind: "dispatch",
      payload: new TextEncoder().encode("hello"),
      gatewayUrl: GATEWAY,
      reward: "5000",
      last_tx: "b".repeat(64),
    });
    const submitting = handler.submitDeviceSignature({ requestId, signatures: await deviceSign(device, deviceKey) });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    release();

    await submitting;
    await expect(pending).resolves.toMatchObject({ type: "BASE" });
  });

  it("a second submission while one is in flight is refused", async () => {
    const { requestId, device } = await approveOnDevice({
      kind: "signDataItem",
      payload: new TextEncoder().encode("hello"),
      dataItems: [{ data: btoa("hello") }],
    });
    const signatures = await deviceSign(device, deviceKey);

    const first = handler.submitDeviceSignature({ requestId, signatures });
    await expect(handler.submitDeviceSignature({ requestId, signatures })).rejects.toThrow(/already being resolved/);
    await first;
  });
});

describe("ApprovalHandler: what the device signs is what was approved", () => {
  it("shows the reward the prepared transaction actually carries", async () => {
    mockNetwork();
    const { view } = await approveOnDevice(() =>
      transfer.submitTransfer({ walletId: HW_ID, token: null, recipient: RECIPIENT, amount: "10", fee: "999" }),
    );

    expect(view.preview).toMatchObject({ fee: "999" });
    expect(view.device!.summaries).toEqual([
      { kind: "transaction", recipient: RECIPIENT, quantity: "10", fee: "1000", dataSize: "0" },
    ]);
  });

  it("summarizes an AO transfer from the item's own tags", async () => {
    const { view } = await approveOnDevice(() =>
      transfer.submitTransfer({ walletId: HW_ID, token: PROCESS_ID, recipient: RECIPIENT, amount: "7", fee: null }),
    );
    expect(view.device!.summaries).toEqual([
      { kind: "aoTransfer", process: PROCESS_ID, recipient: RECIPIENT, quantity: "7" },
    ]);
  });

  it.each([
    ["recipient", (transaction: Record<string, unknown>) => ({ ...transaction, target: "x".repeat(43) })],
    ["amount", (transaction: Record<string, unknown>) => ({ ...transaction, quantity: "999999" })],
    ["tags", (transaction: Record<string, unknown>) => ({ ...transaction, tags: [] })],
    ["data", (transaction: Record<string, unknown>) => ({ ...transaction, data: "" })],
    ["fee", (transaction: Record<string, unknown>) => ({ ...transaction, reward: "1" })],
  ])("refuses a prepared transaction whose %s differs from the request", async (field, alter) => {
    tamper.transaction = alter;
    const pending = handler.requestApproval({
      kind: "sign",
      origin: ORIGIN,
      walletId: HW_ID,
      payload: new TextEncoder().encode("hello"),
      tags: [{ name: "App-Name", value: "Gleam" }],
      gatewayUrl: GATEWAY,
      target: RECIPIENT,
      quantity: "10",
      reward: "5000",
      last_tx: "b".repeat(64),
    });
    const rejected = expect(pending).rejects.toThrow(`prepared ${field} doesn't match`);
    await vi.waitFor(() => expect(windows.opened.length).toBe(1));
    await expect(
      handler.resolveApproval({ requestId: requestIdOf(windows.opened[0]!), approved: true }),
    ).rejects.toThrow(`prepared ${field} doesn't match`);
    await rejected;
  });
});
