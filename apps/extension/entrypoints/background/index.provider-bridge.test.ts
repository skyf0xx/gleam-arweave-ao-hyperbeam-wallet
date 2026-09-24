import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { generateJWK, type JWKInterface } from "@gleam/core";

/**
 * Drives real `window.arweaveWallet` calls through the injected provider,
 * the content-script relay and the background dispatcher, with every hop
 * JSON-serialized the way `postMessage`, extension messaging and
 * `chrome.storage` serialize in Chrome.
 */

type Handler = (message: { data: unknown; sender: unknown }) => unknown;

// sendMessage is only called by the content script (and the background's
// tab pushes); direct handler calls stand in for the approval window.
const CONTENT_SENDER = { url: `${location.origin}/`, frameId: 0, tab: { id: 1, url: `${location.origin}/` } };
const APPROVAL_SENDER = { url: "chrome-extension://test/approval.html", frameId: 0, tab: { id: 2 } };

const jsonClone = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const registeredHandlers = new Map<string, Handler>();
const onMessage = vi.fn((type: string, handler: Handler) => {
  registeredHandlers.set(type, handler);
  return () => registeredHandlers.delete(type);
});
const sendMessage = vi.fn(async (type: string, data: unknown) => {
  const handler = registeredHandlers.get(type);
  if (!handler) throw new Error(`No handler for "${type}".`);
  return jsonClone(await handler({ data: jsonClone(data), sender: CONTENT_SENDER }));
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
    windows: { create: windowsCreate, remove: vi.fn(), update: vi.fn(), onRemoved: { addListener: vi.fn() } },
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
  signDataItem(dataItem: unknown, options?: unknown): Promise<unknown>;
  batchSignDataItem(dataItems: unknown, options?: unknown): Promise<unknown>;
  addToken(id: string, type?: unknown, gateway?: unknown): Promise<void>;
  isTokenAdded(id: string): Promise<unknown>;
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
  await registeredHandlers.get("resolveApproval")!({ data: { requestId: request.requestId, approved: true }, sender: APPROVAL_SENDER });
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
    { origin: location.origin, walletId: WALLET_ID, permissions: ["SIGNATURE", "ENCRYPT", "DECRYPT", "SIGN_TRANSACTION"], createdAt: 0, expiresAt: null, budget: null },
  ]);
  store.set("session:unlockedSession", {
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
    autoLockTimeout: "never",
    unlockedWalletIds: [WALLET_ID],
  });
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

  it("signature carries saltLength through to the signer", async () => {
    const data = new Uint8Array([4, 5, 6]);
    const { result } = await approved<Uint8Array>(wallet.signature(data, { name: "RSA-PSS", saltLength: 0 }));

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", e: "AQAB", n: jwk.n },
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["verify"],
    );
    await expect(crypto.subtle.verify({ name: "RSA-PSS", saltLength: 0 }, key, new Uint8Array(result), data)).resolves.toBe(true);
    await expect(crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, key, new Uint8Array(result), data)).resolves.toBe(false);
  });

  it("signature refuses options that aren't RSA-PSS before asking for approval", async () => {
    await expect(wallet.signature(new Uint8Array([1]), { name: "RSASSA-PKCS1-v1_5" })).rejects.toThrow(/RSA-PSS/);
    expect(windowsCreate).not.toHaveBeenCalled();
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

  it("encrypt and decrypt hand WebCrypto no label key, after every JSON hop, as Chrome requires", async () => {
    // Emulates Chrome: a present `label` that isn't a BufferSource throws,
    // even when it is `undefined`.
    const chromeLabelCheck = (params: unknown) => {
      if (params && typeof params === "object" && "label" in params) {
        const { label } = params as { label: unknown };
        if (!(ArrayBuffer.isView(label) || Object.prototype.toString.call(label) === "[object ArrayBuffer]")) {
          throw new TypeError("RsaOaepParams: label: Not a BufferSource");
        }
      }
    };
    const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const realDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const encryptSpy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (params, key, data) => {
      chromeLabelCheck(params);
      return realEncrypt(params, key, data);
    });
    const decryptSpy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (params, key, data) => {
      chromeLabelCheck(params);
      return realDecrypt(params, key, data);
    });

    try {
      const { result: ciphertext } = await approved<Uint8Array>(wallet.encrypt("secret", { name: "RSA-OAEP" }));
      const { result: plaintext } = await approved<Uint8Array>(
        wallet.decrypt(ciphertext, { name: "RSA-OAEP", label: null }),
      );
      expect(new TextDecoder().decode(plaintext)).toBe("secret");
      expect(encryptSpy.mock.calls[0]![0]).toStrictEqual({ name: "RSA-OAEP" });
      expect(decryptSpy.mock.calls[0]![0]).toStrictEqual({ name: "RSA-OAEP" });

      const label = new TextEncoder().encode("ctx");
      const { result: labelled } = await approved<Uint8Array>(wallet.encrypt("secret", { name: "RSA-OAEP", label }));
      const { result: unlabelled } = await approved<Uint8Array>(wallet.decrypt(labelled, { name: "RSA-OAEP", label }));
      expect(new TextDecoder().decode(unlabelled)).toBe("secret");
    } finally {
      encryptSpy.mockRestore();
      decryptSpy.mockRestore();
    }
  });

  it("rejects a stray label or IV clearly, without opening a window", async () => {
    await expect(wallet.encrypt("data", { name: "RSA-OAEP", label: {} })).rejects.toThrow(
      /encrypt: RSA-OAEP label must be an ArrayBuffer or Uint8Array/,
    );
    await expect(wallet.decrypt(new Uint8Array([1]), { name: "AES-GCM", iv: null })).rejects.toThrow(
      /decrypt: AES-GCM iv is required/,
    );
    expect(windowsCreate).not.toHaveBeenCalled();
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

describe("provider data item methods, end to end", () => {
  const PROCESS_ID = "vh-NTHVvlKZqRxc8LyyTNok65yQ55a_PJ1zWLb9G2JI";
  const isArrayBuffer = (value: unknown) => Object.prototype.toString.call(value) === "[object ArrayBuffer]";
  /** ANS-104: 2-byte signature type, 512-byte signature, then the 512-byte owner. */
  const ownerOf = (raw: ArrayBuffer) => toBase64Url(new Uint8Array(raw).slice(514, 1026));
  const endsWith = (raw: ArrayBuffer, text: string) =>
    new TextDecoder().decode(new Uint8Array(raw).slice(-new TextEncoder().encode(text).byteLength)) === text;

  it("signDataItem takes aoconnect's item shape and resolves to the raw signed ArrayBuffer", async () => {
    const { result, request } = await approved<ArrayBuffer>(
      wallet.signDataItem({ data: "1 + 1", tags: [{ name: "Action", value: "Eval" }], target: PROCESS_ID }),
    );

    expect(request.kind).toBe("signDataItem");
    expect(request.preview.decodedData).toBe("1 + 1");
    expect(request.preview.tags).toEqual([{ name: "Action", value: "Eval" }]);
    expect(isArrayBuffer(result)).toBe(true);
    expect(Array.from(new Uint8Array(result).slice(0, 2))).toEqual([1, 0]);
    expect(ownerOf(result)).toBe(jwk.n);
    expect(endsWith(result, "1 + 1")).toBe(true);
  });

  it("signDataItem signs binary data as given", async () => {
    const { result } = await approved<ArrayBuffer>(wallet.signDataItem({ data: new Uint8Array([0xff, 0x00, 0x7f]) }));
    expect(Array.from(new Uint8Array(result).slice(-3))).toEqual([0xff, 0x00, 0x7f]);
  });

  it("batchSignDataItem resolves to one ArrayBuffer per item, in order", async () => {
    const { result } = await approved<ArrayBuffer[]>(
      wallet.batchSignDataItem([{ data: "first" }, { data: "second", target: PROCESS_ID }]),
    );
    expect(result).toHaveLength(2);
    expect(result.every(isArrayBuffer)).toBe(true);
    expect(endsWith(result[0]!, "first")).toBe(true);
    expect(endsWith(result[1]!, "second")).toBe(true);
  });

  it("rejects a malformed item clearly, without opening a window", async () => {
    await expect(wallet.signDataItem({ data: "x", target: "not-an-address" })).rejects.toThrow(/Arweave address/);
    await expect(wallet.signDataItem({ tags: [] })).rejects.toThrow(/needs data/);
    await expect(wallet.batchSignDataItem([])).rejects.toThrow(/non-empty array/);
    expect(windowsCreate).not.toHaveBeenCalled();
  });
});

describe("provider token list methods, end to end", () => {
  const PROCESS_ID = "t".repeat(43);
  const AO_PROCESS_ID = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    store.set("local:grants", [
      { origin: location.origin, walletId: WALLET_ID, permissions: ["ACCESS_TOKENS"], createdAt: 0, expiresAt: null, budget: null },
    ]);
    // HyperBEAM answers the balance; the gateway answers the spawn tags.
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("/graphql")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              transactions: {
                edges: [
                  {
                    node: {
                      id: PROCESS_ID,
                      tags: [
                        { name: "Ticker", value: "TKN" },
                        { name: "Name", value: "Token" },
                        { name: "Denomination", value: "6" },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => "1000000" };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("addToken asks for approval with the resolved token, then isTokenAdded sees it", async () => {
    await expect(wallet.isTokenAdded(PROCESS_ID)).resolves.toBe(false);

    const { result, request } = await approved<undefined>(wallet.addToken(PROCESS_ID, "asset"));

    expect(result).toBeUndefined();
    expect(request.kind).toBe("addToken");
    expect(request.preview).toEqual({ kind: "addToken", processId: PROCESS_ID, ticker: "TKN", name: "Token", address: "addr-1" });
    expect(store.get("local:watchedProcessIds:addr-1")).toEqual([PROCESS_ID]);
    await expect(wallet.isTokenAdded(PROCESS_ID)).resolves.toBe(true);
  });

  it("addToken resolves without a window when the token is already listed", async () => {
    store.set("local:watchedProcessIds:addr-1", [PROCESS_ID]);
    await expect(wallet.addToken(PROCESS_ID)).resolves.toBeUndefined();
    await expect(wallet.addToken(AO_PROCESS_ID)).resolves.toBeUndefined();
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  it("addToken stores nothing when the user rejects", async () => {
    const call = wallet.addToken(PROCESS_ID);
    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    const pending = store.get("session:pendingApprovals") as Array<{ request: { requestId: string } }>;
    await registeredHandlers.get("resolveApproval")!({
      data: { requestId: pending[0]!.request.requestId, approved: false },
      sender: APPROVAL_SENDER,
    });

    await expect(call).rejects.toThrow(/rejected/);
    expect(store.get("local:watchedProcessIds:addr-1")).toBeUndefined();
  });

  it("rejects an id that isn't a process id, without opening a window", async () => {
    await expect(wallet.addToken("not-a-process")).rejects.toThrow(/AO process id/);
    await expect(wallet.isTokenAdded("")).rejects.toThrow(/AO process id/);
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  it("addToken and isTokenAdded need only a connection", async () => {
    store.set("local:grants", [
      { origin: location.origin, walletId: WALLET_ID, permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
    ]);
    await expect(wallet.isTokenAdded(PROCESS_ID)).resolves.toBe(false);

    const { request } = await approved(wallet.addToken(PROCESS_ID));
    expect(request.kind).toBe("addToken");

    store.delete("local:grants");
    await expect(wallet.addToken(PROCESS_ID)).rejects.toThrow(/not connected/);
    await expect(wallet.isTokenAdded(PROCESS_ID)).rejects.toThrow(/not connected/);
  });
});
