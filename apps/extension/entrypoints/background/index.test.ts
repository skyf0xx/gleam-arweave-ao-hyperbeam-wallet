import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Same resolved-path mocking approach `transfer.send.test.ts` uses:
 * `@permaweb/aoconnect` is a `packages/core`-only dependency, so mocking
 * it by bare specifier from this package's test file would silently miss
 * the copy `core/ao/transfer.ts` actually resolves. Needed here because
 * this file's `transferAoTokens` integration test drives the real
 * dispatcher -> ApprovalHandler -> TransferHandler -> `core/ao/transfer.ts`
 * chain end-to-end, and that last hop would otherwise make a real network
 * call.
 */
const { aoMessageMock, aoconnectResolvedPath } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require("node:module") as typeof import("node:module");
  const requireFromCore = createRequire(`${process.cwd()}/packages/core/package.json`);
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
      "getLockSettings",
      "setLockSettings",
      "getNetworkSettings",
      "setNetworkSettings",
      "getThemePreference",
      "setThemePreference",
      "revokeGrant",
      "getBalance",
      "getTokenBalances",
      "getActivity",
      "getPortfolioHistory",
      "getConnectedApps",
      "providerCall",
    ]) {
      expect(registeredHandlers.has(method)).toBe(true);
    }
  });

  /**
   * MAIN-SCREEN-CHART-WALLET-CORE's inherited debt: `ReadsHandler.
   * getPortfolioHistory()` (already fully tested on its own) was never
   * registered against the dispatcher, so the main-screen chart had no
   * reachable RPC. Drives the real registered handler with no wallets
   * present — the one branch that returns without any network call (see
   * `reads.ts`'s own doc comment on `resolveActiveWalletAddress`) — so
   * this proves the wiring reaches `ReadsHandler` itself, not a
   * reimplementation of its range validation or pricing logic.
   */
  it("getPortfolioHistory is reachable through the dispatcher and delegates to ReadsHandler", async () => {
    const handler = registeredHandlers.get("getPortfolioHistory")!;
    await expect(handler({ data: { range: "24H" } })).resolves.toEqual({
      range: "24H",
      series: [],
      currentUsdValue: 0,
      usdChange: 0,
      periodLabel: "Last 24 hours",
    });
  });

  it("getPortfolioHistory rejects an unrecognized range, same as ReadsHandler itself", async () => {
    const handler = registeredHandlers.get("getPortfolioHistory")!;
    await expect(handler({ data: { range: "3Y" } })).rejects.toThrow(/unrecognized portfolio history range/i);
  });

  /**
   * Theme preference: dispatcher registration is this task's own debt to
   * clear (THEME-PREFERENCE-WALLET-CORE's inherited debt note) — drives
   * the real registered handlers end-to-end through the mocked storage
   * above, exactly like `getLockSettings`/`setLockSettings` already do,
   * rather than re-testing `WalletLifecycleHandler`'s own validation
   * (already covered by its own test file).
   */
  it("getThemePreference defaults to light with no stored preference", async () => {
    const handler = registeredHandlers.get("getThemePreference")!;
    await expect(handler({ data: undefined })).resolves.toEqual({ theme: "light" });
  });

  it("setThemePreference persists a preference that a later getThemePreference reflects", async () => {
    const setHandler = registeredHandlers.get("setThemePreference")!;
    const getHandler = registeredHandlers.get("getThemePreference")!;

    await setHandler({ data: { theme: "dark" } });
    await expect(getHandler({ data: undefined })).resolves.toEqual({ theme: "dark" });
  });

  it("setThemePreference rejects an invalid theme value", async () => {
    const setHandler = registeredHandlers.get("setThemePreference")!;
    await expect(setHandler({ data: { theme: "system" } })).rejects.toThrow(/invalid theme/i);
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

  /**
   * `transferAoTokens` end-to-end, per this task's RELEVANT RULES: exercised
   * through the real dispatcher (`providerCall`) -> `ApprovalHandler`
   * (approval window preview + resolution) -> `TransferHandler.
   * submitTransfer` -> `core/ao/transfer.ts` (mocked at the aoconnect
   * boundary above, never at any layer this task owns) -> the connected
   * dApp's resolved result. Proves the same approval-gated path every other
   * signing method already goes through, not a trusted-RPC shortcut, and
   * that the approval preview carries `token` for the connected origin's
   * request.
   */
  it("transferAoTokens routes through connect -> approval window -> signing, never auto-approved", async () => {
    aoMessageMock.mockResolvedValue("ao-message-id-123");

    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("session:unlockedSession", {
      unlockedAt: 0,
      lastActivityAt: 0,
      autoLockTimeout: "never",
      unlockedWalletIds: ["wallet-1"],
    });
    await setItem("local:networkSettings", {
      gatewayUrl: "https://arweave.net",
      peers: [{ url: "https://hyperbeam.example", enabled: true }],
      activePeerUrl: "https://hyperbeam.example",
    });
    await setItem("local:grants", [
      {
        origin: "https://bazar.arweave.net",
        walletId: "wallet-1",
        permissions: ["ACCESS_ADDRESS"],
        createdAt: 0,
        expiresAt: null,
        budget: null,
      },
    ]);

    // The unlocked-session key cache (`key-session.ts`) — populated in a
    // real run by `unlockWallet`, seeded directly here since this test
    // drives the dispatcher module fresh per `beforeEach`'s `resetModules`.
    const { cacheKey } = await import("@/src/handlers/key-session");
    cacheKey("wallet-1", { kty: "RSA", n: "n", e: "e" } as never, "addr-1");

    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "transferAoTokens",
      params: { token: "ao-process-id", recipient: "recipient-addr", amount: "1000" },
    });

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());

    const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{
      request: { requestId: string; kind: string; preview: Record<string, unknown> };
    }>;
    expect(pendingRaw).toHaveLength(1);
    const { request } = pendingRaw[0]!;
    expect(request.kind).toBe("transferAoTokens");
    expect(request.preview).toMatchObject({
      kind: "transferAoTokens",
      recipient: "recipient-addr",
      amount: "1000",
      token: "ao-process-id",
    });

    // Not auto-approved: the dApp's call must still be pending at this point.
    let settled = false;
    void resultPromise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    const resolveApproval = registeredHandlers.get("resolveApproval")!;
    await resolveApproval({ data: { requestId: request.requestId, approved: true } });

    await expect(resultPromise).resolves.toEqual({ id: "ao-message-id-123" });
    expect(aoMessageMock).toHaveBeenCalledTimes(1);
  });

  it("transferAoTokens for an unconnected origin is rejected before any approval window opens", async () => {
    await expect(
      providerCall({
        origin: "https://not-connected.example",
        method: "transferAoTokens",
        params: { token: "ao-process-id", recipient: "recipient-addr", amount: "1000" },
      }),
    ).rejects.toThrow(/not connected/i);
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  it("transferAoTokens rejects when the request is missing required fields", async () => {
    await setItem("local:grants", [
      {
        origin: "https://bazar.arweave.net",
        walletId: "wallet-1",
        permissions: ["ACCESS_ADDRESS"],
        createdAt: 0,
        expiresAt: null,
        budget: null,
      },
    ]);

    await expect(
      providerCall({ origin: "https://bazar.arweave.net", method: "transferAoTokens", params: { token: "ao-process-id" } }),
    ).rejects.toThrow(/requires token, recipient, and amount/i);
  });
});
