import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { generateJWK, type JWKInterface } from "@gleam/core";

/**
 * Drives real `window.arweaveWallet` calls through the injected provider,
 * the content-script relay and the background dispatcher, with every hop
 * JSON-serialized the way `postMessage`, extension messaging and
 * `chrome.storage` serialize in Chrome.
 */

type Handler = (message: { data: unknown }) => unknown;

const jsonClone = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const registeredHandlers = new Map<string, Handler>();
const onMessage = vi.fn((type: string, handler: Handler) => {
  registeredHandlers.set(type, handler);
  return () => registeredHandlers.delete(type);
});
const sendMessage = vi.fn(async (type: string, data: unknown) => {
  const handler = registeredHandlers.get(type);
  if (!handler) throw new Error(`No handler for "${type}".`);
  return jsonClone(await handler({ data: jsonClone(data) }));
});

vi.mock("@webext-core/messaging", () => ({
  defineExtensionMessaging: () => ({ onMessage, sendMessage }),
}));

const store = new Map<string, unknown>();
const watchers = new Map<string, Set<(value: unknown) => void>>();
vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: async (key: string) => (store.has(key) ? jsonClone(store.get(key)) : null),
    setItem: async (key: string, value: unknown) => {
      store.set(key, jsonClone(value));
      for (const cb of watchers.get(key) ?? []) cb(jsonClone(value));
    },
    removeItem: async (key: string) => {
      store.delete(key);
      for (const cb of watchers.get(key) ?? []) cb(null);
    },
    watch: (key: string, cb: (value: unknown) => void) => {
      const set = watchers.get(key) ?? new Set();
      set.add(cb);
      watchers.set(key, set);
      return () => watchers.get(key)?.delete(cb);
    },
  },
}));

const windowsCreate = vi.fn().mockResolvedValue({ id: 1 });
vi.mock("wxt/browser", () => ({
  browser: {
    windows: { create: windowsCreate, remove: vi.fn(), update: vi.fn() },
    runtime: { getURL: (path: string) => `chrome-extension://test${path}`, onSuspend: { addListener: vi.fn() } },
    tabs: { query: vi.fn().mockResolvedValue([]) },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  },
}));

vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (fn: () => void) => ({ main: fn }),
}));
vi.mock("wxt/utils/inject-script", () => ({ injectScript: vi.fn().mockResolvedValue(undefined) }));

interface Wallet {
  signMessage(data: unknown, options?: unknown): Promise<unknown>;
  signature(data: unknown, options?: unknown): Promise<unknown>;
  privateHash(data: unknown, options?: unknown): Promise<unknown>;
  verifyMessage(data: unknown, signature: unknown, publicKey?: unknown, options?: unknown): Promise<unknown>;
  encrypt(data: unknown, options?: unknown): Promise<unknown>;
  decrypt(data: unknown, options?: unknown): Promise<unknown>;
}

const WALLET_ID = "wallet-1";
let jwk: JWKInterface;
let wallet: Wallet;
let postMessageSpy: ReturnType<typeof vi.spyOn>;
let addListenerSpy: ReturnType<typeof vi.spyOn>;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Resolves the one pending approval as the approval window would, once it opens. */
async function approveNext(): Promise<{ kind: string; preview: Record<string, unknown> }> {
  await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
  const pending = store.get("session:pendingApprovals") as Array<{
    request: { requestId: string; kind: string; preview: Record<string, unknown> };
  }>;
  const { request } = pending[0]!;
  await registeredHandlers.get("resolveApproval")!({ data: { requestId: request.requestId, approved: true } });
  windowsCreate.mockClear();
  return request;
}

async function approved<T>(call: Promise<unknown>): Promise<{ result: T; request: Awaited<ReturnType<typeof approveNext>> }> {
  const request = await approveNext();
  return { result: (await call) as T, request };
}

beforeAll(async () => {
  jwk = await generateJWK();
});

beforeEach(async () => {
  vi.resetModules();
  registeredHandlers.clear();
  store.clear();
  watchers.clear();
  windowsCreate.mockClear();

  // jsdom delivers `postMessage` with `event.source === null`; real
  // browsers set it to the posting window, which both sides check.
  postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    const data = structuredClone(message);
    setTimeout(() => window.dispatchEvent(new MessageEvent("message", { data, source: window })), 0);
  });

  // The provider and the content script listen on the shared jsdom
  // window; each test removes its own so earlier bridges don't relay too.
  addListenerSpy = vi.spyOn(window, "addEventListener");

  await import("./index");
  const content = (await import("../content/index")).default;
  await content.main!({} as never);
  const { GleamProvider } = await import("../provider/index");
  wallet = new GleamProvider() as unknown as Wallet;

  store.set("local:wallets", [
    { id: WALLET_ID, address: "addr-1", name: "Main", method: "jwk", publicKey: jwk.n, createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
  ]);
  store.set("local:activeWalletId", WALLET_ID);
  store.set("local:grants", [
    { origin: location.origin, walletId: WALLET_ID, permissions: ["SIGNATURE"], createdAt: 0, expiresAt: null, budget: null },
  ]);
  const { cacheKey } = await import("@/src/handlers/key-session");
  await cacheKey(WALLET_ID, jwk, "addr-1");
});

afterEach(() => {
  for (const [type, listener] of addListenerSpy.mock.calls) {
    window.removeEventListener(type as string, listener as EventListener);
  }
  addListenerSpy.mockRestore();
  postMessageSpy.mockRestore();
});

describe("provider message methods, end to end", () => {
  it("signMessage returns a Uint8Array that verifyMessage accepts with the active key by default", async () => {
    const message = new TextEncoder().encode("hello gleam");

    const { result: signature, request } = await approved<Uint8Array>(
      wallet.signMessage(message.buffer, { hashAlgorithm: "SHA-256" }),
    );

    expect(request.kind).toBe("signMessage");
    expect(request.preview.decodedData).toBe("hello gleam");
    expect(ArrayBuffer.isView(signature)).toBe(true);
    expect(signature.byteLength).toBe(512);

    await expect(wallet.verifyMessage(message, signature)).resolves.toBe(true);
    await expect(wallet.verifyMessage(message, toBase64Url(signature), jwk.n)).resolves.toBe(true);
    await expect(wallet.verifyMessage(new TextEncoder().encode("tampered"), signature)).resolves.toBe(false);
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  it("verifyMessage honours the hashAlgorithm option", async () => {
    const message = new TextEncoder().encode("sha-512 message");
    const { result: signature } = await approved<Uint8Array>(
      wallet.signMessage(message, { hashAlgorithm: "SHA-512" }),
    );

    await expect(wallet.verifyMessage(message, signature, undefined, { hashAlgorithm: "SHA-512" })).resolves.toBe(true);
    await expect(wallet.verifyMessage(message, signature)).resolves.toBe(false);
  });

  it("signature returns the raw signature bytes", async () => {
    const { result } = await approved<Uint8Array>(wallet.signature(new Uint8Array([1, 2, 3]), { name: "RSA-PSS", saltLength: 32 }));
    expect(ArrayBuffer.isView(result)).toBe(true);
    expect(result.byteLength).toBe(512);
  });

  it("privateHash returns a Uint8Array digest of the requested size", async () => {
    const { result } = await approved<Uint8Array>(wallet.privateHash(new Uint8Array([1, 2, 3]), { hashAlgorithm: "SHA-512" }));
    expect(ArrayBuffer.isView(result)).toBe(true);
    expect(result.byteLength).toBe(64);
  });

  it("encrypt takes a string and RSA-OAEP params, and decrypt returns the plaintext bytes", async () => {
    const { result: ciphertext, request } = await approved<Uint8Array>(
      wallet.encrypt("top secret", { name: "RSA-OAEP" }),
    );
    expect(request.kind).toBe("encrypt");
    expect(ArrayBuffer.isView(ciphertext)).toBe(true);
    expect(ciphertext.byteLength).toBe(512);

    const { result: plaintext } = await approved<Uint8Array>(wallet.decrypt(ciphertext, { name: "RSA-OAEP" }));
    expect(ArrayBuffer.isView(plaintext)).toBe(true);
    expect(new TextDecoder().decode(plaintext)).toBe("top secret");
  });

  it("encrypt with AES-GCM carries the IV through every hop", async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const { result: ciphertext } = await approved<Uint8Array>(
      wallet.encrypt(new TextEncoder().encode("aes"), { name: "AES-GCM", iv }),
    );
    const { result: plaintext } = await approved<Uint8Array>(wallet.decrypt(ciphertext, { name: "AES-GCM", iv }));
    expect(new TextDecoder().decode(plaintext)).toBe("aes");
  });

  it("rejects the deprecated encrypt options clearly, without opening a window", async () => {
    await expect(wallet.encrypt("data", { algorithm: "RSA-OAEP", hash: "SHA-256" })).rejects.toThrow(
      /deprecated \{ algorithm, hash, salt \}/,
    );
    await expect(wallet.decrypt(new Uint8Array([1]))).rejects.toThrow(/requires an algorithm/);
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  it("rejects an unsupported hashAlgorithm and a non-binary message", async () => {
    await expect(wallet.signMessage(new Uint8Array([1]), { hashAlgorithm: "MD5" })).rejects.toThrow(
      /does not support hashAlgorithm "MD5"/,
    );
    await expect(wallet.signMessage("plain text")).rejects.toThrow(/"data" must be an ArrayBuffer or Uint8Array/);
    expect(windowsCreate).not.toHaveBeenCalled();
  });
});
