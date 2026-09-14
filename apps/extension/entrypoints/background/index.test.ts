import { describe, expect, it, vi, beforeEach } from "vitest";

type Handler = (message: { data: unknown }) => unknown;

const registeredHandlers = new Map<string, Handler>();
const onMessage = vi.fn((type: string, handler: Handler) => {
  registeredHandlers.set(type, handler);
  return () => registeredHandlers.delete(type);
});
const sendMessage = vi.fn();

vi.mock("@webext-core/messaging", () => ({
  defineExtensionMessaging: () => ({ onMessage, sendMessage }),
}));

const store = new Map<string, unknown>();
const watchers = new Map<string, Set<(value: unknown) => void>>();
const getItem = vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null));
const setItem = vi.fn(async (key: string, value: unknown) => {
  store.set(key, value);
  for (const cb of watchers.get(key) ?? []) cb(value);
});
const removeItem = vi.fn(async (key: string) => {
  store.delete(key);
  for (const cb of watchers.get(key) ?? []) cb(null);
});
const watchFn = vi.fn((key: string, cb: (value: unknown) => void) => {
  const set = watchers.get(key) ?? new Set();
  set.add(cb);
  watchers.set(key, set);
  return () => watchers.get(key)?.delete(cb);
});

vi.mock("wxt/utils/storage", () => ({
  storage: { getItem, setItem, removeItem, watch: watchFn },
}));

const windowsCreate = vi.fn().mockResolvedValue({ id: 1 });
vi.mock("wxt/browser", () => ({
  browser: {
    windows: { create: windowsCreate, remove: vi.fn(), update: vi.fn() },
    runtime: { getURL: (path: string) => `chrome-extension://test${path}` },
  },
}));

vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (fn: () => void) => ({ main: fn }),
}));

/**
 * The privilege-tier choke point (this task's highest-stakes rule): a
 * page-originated `providerCall` message can only ever reach
 * `PROVIDER_METHODS`. Drives the real `onMessage("providerCall", ...)`
 * handler `background.ts` registers, captured via the mocked messenger
 * above — this is the actual dispatcher code running, not a
 * reimplementation of its logic.
 */
describe("background.ts: providerCall privilege-tier choke point", () => {
  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers.clear();
    store.clear();
    watchers.clear();
    onMessage.mockClear();
    sendMessage.mockClear();
    windowsCreate.mockClear();
    await import("./index");
  });

  function providerCall(data: unknown) {
    const handler = registeredHandlers.get("providerCall");
    if (!handler) throw new Error("providerCall was never registered.");
    return handler({ data });
  }

  it("registers a handler for every ProtocolMap method this layer owns", () => {
    for (const method of [
      "createWallet",
      "importWallet",
      "exportWallet",
      "getState",
      "getApproval",
      "resolveApproval",
      "unlockApprovalWallet",
      "revokeGrant",
      "providerCall",
    ]) {
      expect(registeredHandlers.has(method)).toBe(true);
    }
  });

  it("rejects a KEY_METHODS name routed through providerCall", () => {
    expect(() => providerCall({ origin: "https://evil.example", method: "createWallet", params: {} })).toThrow(
      /not reachable from a web page/i,
    );
  });

  it("rejects an APPROVAL_METHODS name routed through providerCall", () => {
    expect(() =>
      providerCall({ origin: "https://evil.example", method: "resolveApproval", params: {} }),
    ).toThrow(/not reachable from a web page/i);
  });

  it("rejects a method name that isn't a real ProtocolMap key at all", () => {
    expect(() =>
      providerCall({ origin: "https://evil.example", method: "deleteWallet", params: {} }),
    ).toThrow(/not reachable from a web page/i);
  });

  it("a PROVIDER_METHODS call for an unconnected origin is rejected until connect() runs", async () => {
    await expect(
      providerCall({ origin: "https://not-connected.example", method: "getActiveAddress", params: {} }),
    ).rejects.toThrow(/not connected/i);
  });

  it("connect() with no unlocked wallet fails with a named error, not a silent grant", async () => {
    await expect(providerCall({ origin: "https://bazar.arweave.net", method: "connect", params: {} })).rejects.toThrow(
      /no unlocked wallet/i,
    );
  });

  it("connect() opens an approval window rather than granting inline", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("session:unlockedSession", {
      unlockedAt: 0,
      lastActivityAt: 0,
      autoLockTimeout: "never",
      unlockedWalletIds: ["wallet-1"],
    });

    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "connect",
      params: { permissions: ["ACCESS_ADDRESS"] },
    });

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    expect(windowsCreate.mock.calls[0]![0]).toMatchObject({ type: "popup", width: 390, height: 640, focused: true });

    // Resolve the pending approval directly through the same registered
    // resolveApproval handler a real approval window would call.
    const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{ request: { requestId: string } }>;
    const requestId = pendingRaw[0]!.request.requestId;
    const resolveApproval = registeredHandlers.get("resolveApproval")!;
    await resolveApproval({ data: { requestId, approved: true } });

    await expect(resultPromise).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });
  });
});
