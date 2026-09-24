import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { METHOD_PERMISSIONS, PERMISSION_TYPES, PROVIDER_METHODS, type PermissionType } from "@gleam/core";
import { encodeTaggedBinary } from "@gleam/messaging/src/page-protocol.ts";

/**
 * This file's `transferAoTokens` integration test drives the real
 * dispatcher -> ApprovalHandler -> TransferHandler -> `core/ao/transfer.ts`
 * chain end-to-end, and that last hop would otherwise sign and post to the
 * real Messenger Unit.
 */
const { aoSubmitMock } = vi.hoisted(() => ({ aoSubmitMock: vi.fn() }));
vi.mock("@gleam/core/src/ao/transfer.ts", () => ({ submitTransfer: aoSubmitMock }));

type Sender = { url?: string; origin?: string; frameId?: number; tab?: { id?: number; url?: string } };
type Handler = (message: { data: unknown; sender?: Sender }) => unknown;

const POPUP_SENDER: Sender = { url: "chrome-extension://test/popup.html" };
const contentSender = (origin: string): Sender => ({ url: `${origin}/app`, frameId: 0, tab: { id: 7, url: `${origin}/app` } });

// Direct handler calls default to the popup as sender; providerCall below
// passes a content-script sender.
const registeredHandlers = new Map<string, Handler>();
const rawHandlers = new Map<string, Handler>();
const onMessage = vi.fn((type: string, handler: Handler) => {
  rawHandlers.set(type, handler);
  registeredHandlers.set(type, (message) => handler({ sender: POPUP_SENDER, ...message }));
  return () => registeredHandlers.delete(type);
});
const sendMessage = vi.fn().mockResolvedValue(undefined);

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
const tabsQuery = vi.fn().mockResolvedValue([]);
const alarmsCreate = vi.fn();
const alarmsAddListener = vi.fn();
const onSuspendAddListener = vi.fn();
vi.mock("wxt/browser", () => ({
  browser: {
    windows: { create: windowsCreate, remove: vi.fn(), update: vi.fn(), onRemoved: { addListener: vi.fn() } },
    runtime: { getURL: (path: string) => `chrome-extension://test${path}`, onSuspend: { addListener: onSuspendAddListener } },
    tabs: { query: tabsQuery },
    alarms: { create: alarmsCreate, onAlarm: { addListener: alarmsAddListener } },
  },
}));

vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (fn: () => void) => ({ main: fn }),
}));

/**
 * The privilege-tier choke point: a page-originated `providerCall`
 * message can only ever reach `PROVIDER_METHODS`. Drives the real
 * `onMessage("providerCall", ...)` handler `background.ts` registers,
 * captured via the mocked messenger above — this is the actual
 * dispatcher code running, not a reimplementation of its logic.
 */
const originalFetch = globalThis.fetch;

describe("background.ts: providerCall privilege-tier choke point", () => {
  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers.clear();
    rawHandlers.clear();
    store.clear();
    watchers.clear();
    onMessage.mockClear();
    sendMessage.mockClear();
    windowsCreate.mockClear();
    tabsQuery.mockClear();
    tabsQuery.mockResolvedValue([]);
    await import("./index");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function providerCall({ origin, ...data }: { origin: string; method: string; params: unknown }): Promise<unknown> {
    const handler = rawHandlers.get("providerCall");
    if (!handler) throw new Error("providerCall was never registered.");
    return handler({ data, sender: contentSender(origin) }) as Promise<unknown>;
  }

  it("registers a handler for every ProtocolMap method this layer owns", () => {
    for (const method of [
      "createWallet",
      "importWallet",
      "exportWallet",
      "getState",
      "resetAllWallets",
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
   * Drives the real registered handler with no wallets present — the one
   * branch that returns without any network call — so this proves the
   * wiring reaches `ReadsHandler` itself, not a reimplementation of its
   * range validation or pricing logic.
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
   * Drives the real registered handlers end-to-end through the mocked
   * storage above, exactly like `getLockSettings`/`setLockSettings` already
   * do, rather than re-testing `WalletLifecycleHandler`'s own validation
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

  /**
   * Drives the real registered dispatcher handler end-to-end through
   * `WalletLifecycleHandler.resetAllWallets()` (already unit-tested on its
   * own) — this proves the wire-up reaches it, not a reimplementation of
   * its wipe logic.
   */
  it("resetAllWallets is reachable through the dispatcher and wipes every stored wallet", async () => {
    const createHandler = registeredHandlers.get("createWallet")!;
    const resetHandler = registeredHandlers.get("resetAllWallets")!;
    const getStateHandler = registeredHandlers.get("getState")!;

    await createHandler({ data: { name: "Wallet 1", password: "correct horse battery staple" } });
    await expect(getStateHandler({ data: undefined })).resolves.toMatchObject({
      wallets: [expect.objectContaining({ name: "Wallet 1" })],
    });

    await expect(resetHandler({ data: undefined })).resolves.toBeUndefined();
    await expect(getStateHandler({ data: undefined })).resolves.toMatchObject({ wallets: [] });
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

  it("does not clear the key cache on runtime.onSuspend, which also fires on idle", () => {
    expect(onSuspendAddListener).not.toHaveBeenCalled();
  });

  it("connect() with no wallet waits for onboarding in the approval window, then grants the new wallet", async () => {
    tabsQuery.mockResolvedValue([{ id: 42, url: "https://bazar.arweave.net/app" }]);
    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "connect",
      params: { permissions: ["ACCESS_ADDRESS"] },
    });

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{
      walletId: string | null;
      request: { requestId: string };
    }>;
    expect(pendingRaw[0]!.walletId).toBeNull();

    // Onboarding inside the approval window creates the first wallet.
    const created = (await registeredHandlers.get("createWallet")!({
      data: { name: "Wallet 1", password: "correct horse battery staple" },
    })) as { id: string; address: string };

    await registeredHandlers.get("resolveApproval")!({
      data: { requestId: pendingRaw[0]!.request.requestId, approved: true },
    });
    await expect(resultPromise).resolves.toEqual({ granted: ["ACCESS_ADDRESS"] });

    expect(await getItem("local:grants")).toEqual([
      expect.objectContaining({ origin: "https://bazar.arweave.net", walletId: created.id }),
    ]);
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "providerEvent",
        { event: "connect", data: { activeAddress: created.address } },
        42,
      ),
    );
  });

  it("connect() on a locked wallet opens the approval window instead of failing", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");

    void providerCall({ origin: "https://bazar.arweave.net", method: "connect", params: {} }).catch(() => undefined);

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    const pending = (await getItem("session:pendingApprovals")) as Array<{ walletId: string }>;
    expect(pending.map((entry) => entry.walletId)).toEqual(["wallet-1"]);
  });

  it("connect() opens an approval window rather than granting inline", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");
    await setItem("session:unlockedSession", {
      unlockedAt: 0,
      lastActivityAt: 0,
      autoLockTimeout: "never",
      unlockedWalletIds: ["wallet-1"],
    });
    // getState reports a wallet with no cached key as locked.
    await setItem("session:key:wallet-1", { jwk: { kty: "RSA", n: "n", e: "e" }, address: "addr-1" });

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
   * `transferAoTokens` end-to-end: exercised through the real dispatcher
   * (`providerCall`) -> `ApprovalHandler` (approval window preview +
   * resolution) -> `TransferHandler.submitTransfer` -> `core/ao/transfer.ts`
   * (mocked at its module boundary above) -> the connected dApp's resolved
   * result. Proves the same approval-gated path every other signing method
   * already goes through, not a trusted-RPC shortcut, and that the approval
   * preview carries `token` for the connected origin's request.
   */
  it("transferAoTokens routes through connect -> approval window -> signing, never auto-approved", async () => {
    aoSubmitMock.mockResolvedValue({ messageId: "ao-message-id-123" });

    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");
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
        permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
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
    expect(aoSubmitMock).toHaveBeenCalledTimes(1);
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
        permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"],
        createdAt: 0,
        expiresAt: null,
        budget: null,
      },
    ]);

    await expect(
      providerCall({ origin: "https://bazar.arweave.net", method: "transferAoTokens", params: { token: "ao-process-id" } }),
    ).rejects.toThrow(/requires token, recipient, and amount/i);
  });

  /**
   * PROVIDER-EVENTS-ACCOUNT-SWITCH-PROVIDER-BRIDGE: `postProviderEvent`
   * wiring at the real connect/disconnect/switchWallet call sites, and the
   * access-control boundary (only a tab whose origin holds an active Grant
   * is ever targeted — never a broadcast to every open tab).
   */
  describe("provider events: connect/disconnect/walletSwitch pushed only to connected origins", () => {
    async function seedUnlockedWallet(walletId: string, address: string): Promise<void> {
      await setItem("local:wallets", [
        { id: walletId, address, name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", walletId);
      await setItem("session:unlockedSession", {
        unlockedAt: 0,
        lastActivityAt: 0,
        autoLockTimeout: "never",
        unlockedWalletIds: [walletId],
      });
      await setItem(`session:key:${walletId}`, { jwk: { kty: "RSA", n: "n", e: "e" }, address });
    }

    it("connect() pushes a CONNECT event only to the tab that just connected", async () => {
      await seedUnlockedWallet("wallet-1", "addr-1");
      tabsQuery.mockResolvedValue([
        { id: 42, url: "https://bazar.arweave.net/app" },
        { id: 99, url: "https://not-connected.example/" },
      ]);

      const resultPromise = providerCall({
        origin: "https://bazar.arweave.net",
        method: "connect",
        params: { permissions: ["ACCESS_ADDRESS"] },
      });

      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
      const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{ request: { requestId: string } }>;
      const requestId = pendingRaw[0]!.request.requestId;
      const resolveApproval = registeredHandlers.get("resolveApproval")!;
      await resolveApproval({ data: { requestId, approved: true } });
      await resultPromise;

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith(
          "providerEvent",
          { event: "connect", data: { activeAddress: "addr-1" } },
          42,
        ),
      );
      expect(sendMessage).not.toHaveBeenCalledWith("providerEvent", expect.anything(), 99);
    });

    it("disconnect() pushes a DISCONNECT event only to the disconnecting origin's tab", async () => {
      await setItem("local:grants", [
        { origin: "https://bazar.arweave.net", walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
      ]);
      tabsQuery.mockResolvedValue([
        { id: 42, url: "https://bazar.arweave.net/app" },
        { id: 99, url: "https://not-connected.example/" },
      ]);

      await providerCall({ origin: "https://bazar.arweave.net", method: "disconnect", params: {} });

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith("providerEvent", { event: "disconnect", data: {} }, 42),
      );
      expect(sendMessage).not.toHaveBeenCalledWith("providerEvent", expect.anything(), 99);
    });

    it("revokeGrant (connected-apps UI revoke) also pushes a DISCONNECT event to that origin's tab", async () => {
      await setItem("local:grants", [
        { origin: "https://bazar.arweave.net", walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
      ]);
      tabsQuery.mockResolvedValue([{ id: 7, url: "https://bazar.arweave.net/" }]);

      const revokeHandler = registeredHandlers.get("revokeGrant")!;
      await revokeHandler({ data: { origin: "https://bazar.arweave.net" } });

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith("providerEvent", { event: "disconnect", data: {} }, 7),
      );
    });

    it("switchWallet broadcasts a WALLET_SWITCH event to every origin with an active Grant, never every open tab", async () => {
      await seedUnlockedWallet("wallet-2", "addr-2");
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
        { id: "wallet-2", address: "addr-2", name: "Two", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-2");
      await setItem("local:grants", [
        { origin: "https://connected-a.example", walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
        { origin: "https://connected-b.example", walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
      ]);
      tabsQuery.mockResolvedValue([
        { id: 1, url: "https://connected-a.example/" },
        { id: 2, url: "https://connected-b.example/" },
        { id: 3, url: "https://unconnected.example/" },
      ]);

      const switchHandler = registeredHandlers.get("switchWallet")!;
      await switchHandler({ data: { walletId: "wallet-2" } });

      await vi.waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith(
          "providerEvent",
          { event: "walletSwitch", data: { address: "addr-2" } },
          1,
        ),
      );
      expect(sendMessage).toHaveBeenCalledWith(
        "providerEvent",
        { event: "walletSwitch", data: { address: "addr-2" } },
        2,
      );
      expect(sendMessage).not.toHaveBeenCalledWith("providerEvent", expect.anything(), 3);
    });

    it("switchWallet never pushes to a tab whose origin has no Grant at all, even when it's open", async () => {
      await seedUnlockedWallet("wallet-2", "addr-2");
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "One", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
        { id: "wallet-2", address: "addr-2", name: "Two", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-2");
      // No `local:grants` entries at all — nothing is connected.
      tabsQuery.mockResolvedValue([{ id: 55, url: "https://never-connected.example/" }]);

      const switchHandler = registeredHandlers.get("switchWallet")!;
      await switchHandler({ data: { walletId: "wallet-2" } });

      expect(sendMessage).not.toHaveBeenCalledWith("providerEvent", expect.anything(), 55);
      // No Grant exists, so `findTabsForOrigin` is never even reached for
      // that origin — `browser.tabs.query` itself is never called on this
      // path, confirming the broadcast is scoped to Grant-holding origins,
      // not "every open tab".
      expect(tabsQuery).not.toHaveBeenCalled();
    });
  });

  describe("provider calls follow the active wallet, not the one that connected", () => {
    const ORIGIN = "https://bazar.arweave.net";

    async function seedTwoWallets(): Promise<void> {
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "One", method: "jwk", publicKey: "pub-1", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
        { id: "wallet-2", address: "addr-2", name: "Two", method: "jwk", publicKey: "pub-2", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-1");
      // Unlock puts the then-active wallet first, so after a switch the
      // first unlocked id is no longer the active one.
      await setItem("session:unlockedSession", {
        unlockedAt: 0,
        lastActivityAt: 0,
        autoLockTimeout: "never",
        unlockedWalletIds: ["wallet-1", "wallet-2"],
      });
      await setItem("session:key:wallet-1", { jwk: { kty: "RSA", n: "n", e: "e" }, address: "addr-1" });
      await setItem("session:key:wallet-2", { jwk: { kty: "RSA", n: "n", e: "e" }, address: "addr-2" });
    }

    async function grant(): Promise<void> {
      await setItem("local:grants", [
        {
          origin: ORIGIN,
          walletId: "wallet-1",
          permissions: ["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "SIGNATURE"],
          createdAt: 0,
          expiresAt: null,
          budget: null,
        },
      ]);
    }

    it("getActiveAddress and getActivePublicKey return the wallet switched to", async () => {
      await seedTwoWallets();
      await grant();
      await expect(providerCall({ origin: ORIGIN, method: "getActiveAddress", params: {} })).resolves.toBe("addr-1");

      await registeredHandlers.get("switchWallet")!({ data: { walletId: "wallet-2" } });

      await expect(providerCall({ origin: ORIGIN, method: "getActiveAddress", params: {} })).resolves.toBe("addr-2");
      await expect(providerCall({ origin: ORIGIN, method: "getActivePublicKey", params: {} })).resolves.toBe("pub-2");
    });

    it("a signing request after a switch is made for the active wallet", async () => {
      await seedTwoWallets();
      await grant();
      await registeredHandlers.get("switchWallet")!({ data: { walletId: "wallet-2" } });

      const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]) });
      void providerCall({ origin: ORIGIN, method: "signature", params }).catch(() => undefined);

      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
      const pending = (await getItem("session:pendingApprovals")) as Array<{ walletId: string }>;
      expect(pending.map((entry) => entry.walletId)).toEqual(["wallet-2"]);
    });

    it("connect() binds to the active wallet, not the first unlocked one", async () => {
      await seedTwoWallets();
      await setItem("local:activeWalletId", "wallet-2");

      const resultPromise = providerCall({ origin: ORIGIN, method: "connect", params: { permissions: ["ACCESS_ADDRESS"] } });
      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
      const pending = (await getItem("session:pendingApprovals")) as Array<{ walletId: string; request: { requestId: string } }>;
      expect(pending[0]!.walletId).toBe("wallet-2");
      await registeredHandlers.get("resolveApproval")!({ data: { requestId: pending[0]!.request.requestId, approved: true } });
      await resultPromise;

      expect(await getItem("local:grants")).toEqual([expect.objectContaining({ origin: ORIGIN, walletId: "wallet-2" })]);
      await expect(providerCall({ origin: ORIGIN, method: "getActiveAddress", params: {} })).resolves.toBe("addr-2");
    });
  });

  describe("connect() from an origin that already has a grant", () => {
    const ORIGIN = "https://bazar.arweave.net";

    async function seedUnlockedWalletWithGrant(): Promise<void> {
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-1");
      await setItem("session:unlockedSession", {
        unlockedAt: 0,
        lastActivityAt: 0,
        autoLockTimeout: "never",
        unlockedWalletIds: ["wallet-1"],
      });
      await setItem("session:key:wallet-1", { jwk: { kty: "RSA", n: "n", e: "e" }, address: "addr-1" });
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions: ["ACCESS_ADDRESS", "SIGNATURE"], createdAt: 0, expiresAt: null, budget: null },
      ]);
    }

    it("resolves without a prompt when the grant covers every requested permission", async () => {
      await seedUnlockedWalletWithGrant();

      await expect(
        providerCall({ origin: ORIGIN, method: "connect", params: { permissions: ["SIGNATURE"] } }),
      ).resolves.toEqual({ granted: ["ACCESS_ADDRESS", "SIGNATURE"] });
      await expect(providerCall({ origin: ORIGIN, method: "connect", params: {} })).resolves.toEqual({
        granted: ["ACCESS_ADDRESS", "SIGNATURE"],
      });
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it("prompts only for the missing permissions and merges them into the grant", async () => {
      await seedUnlockedWalletWithGrant();

      const resultPromise = providerCall({
        origin: ORIGIN,
        method: "connect",
        params: { permissions: ["ACCESS_ADDRESS", "ACCESS_TOKENS"] },
      });
      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
      const pending = (await getItem("session:pendingApprovals")) as Array<{
        request: { requestId: string; preview: { requestedPermissions: string[] } };
      }>;
      expect(pending[0]!.request.preview.requestedPermissions).toEqual(["ACCESS_TOKENS"]);

      await registeredHandlers.get("resolveApproval")!({ data: { requestId: pending[0]!.request.requestId, approved: true } });
      await expect(resultPromise).resolves.toEqual({ granted: ["ACCESS_ADDRESS", "SIGNATURE", "ACCESS_TOKENS"] });
      expect(await getItem("local:grants")).toEqual([
        expect.objectContaining({ origin: ORIGIN, permissions: ["ACCESS_ADDRESS", "SIGNATURE", "ACCESS_TOKENS"] }),
      ]);
    });

    it("prompts again once the grant has expired", async () => {
      await seedUnlockedWalletWithGrant();
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: 1, budget: null },
      ]);

      void providerCall({ origin: ORIGIN, method: "connect", params: {} }).catch(() => undefined);
      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    });
  });

  describe("deleteWallet keeps site grants unless no wallet is left", () => {
    const wallet = (id: string, address: string) => ({
      id,
      address,
      name: id,
      method: "jwk",
      publicKey: `pub-${address}`,
      createdAt: 0,
      updatedAt: 0,
      encryptedKeyfile: null,
    });
    const grantFor = (origin: string, walletId: string) => ({
      origin,
      walletId,
      permissions: ["ACCESS_ADDRESS", "SIGNATURE"],
      createdAt: 0,
      expiresAt: null,
      budget: null,
    });

    async function seed(walletIds: string[], activeWalletId: string): Promise<void> {
      await setItem(
        "local:wallets",
        walletIds.map((id) => wallet(id, `addr-${id}`)),
      );
      await setItem("local:activeWalletId", activeWalletId);
      await setItem("session:unlockedSession", {
        unlockedAt: 0,
        lastActivityAt: 0,
        autoLockTimeout: "never",
        unlockedWalletIds: walletIds,
      });
      for (const id of walletIds) {
        await setItem(`session:key:${id}`, { jwk: { kty: "RSA", n: "n", e: "e" }, address: `addr-${id}` });
      }
      await setItem("local:grants", [
        grantFor("https://a.example", walletIds[0]!),
        grantFor("https://b.example", walletIds[walletIds.length - 1]!),
      ]);
      tabsQuery.mockResolvedValue([
        { id: 1, url: "https://a.example/" },
        { id: 2, url: "https://b.example/" },
      ]);
    }

    const deleteWallet = (walletId: string) => registeredHandlers.get("deleteWallet")!({ data: { walletId } });
    const grantOrigins = async () =>
      ((await getItem("local:grants")) as Array<{ origin: string }> | null)?.map((grant) => grant.origin) ?? [];

    it("deleting an inactive wallet keeps every grant and pushes no event", async () => {
      await seed(["wallet-1", "wallet-2"], "wallet-1");

      await deleteWallet("wallet-2");

      expect(await grantOrigins()).toEqual(["https://a.example", "https://b.example"]);
      await Promise.resolve();
      expect(sendMessage).not.toHaveBeenCalledWith("providerEvent", expect.anything(), expect.anything());
      await expect(providerCall({ origin: "https://b.example", method: "getActiveAddress", params: {} })).resolves.toBe(
        "addr-wallet-1",
      );
    });

    it("deleting the active wallet keeps grants and announces the new active address", async () => {
      await seed(["wallet-1", "wallet-2"], "wallet-2");

      await deleteWallet("wallet-2");

      expect(await grantOrigins()).toEqual(["https://a.example", "https://b.example"]);
      for (const tabId of [1, 2]) {
        await vi.waitFor(() =>
          expect(sendMessage).toHaveBeenCalledWith(
            "providerEvent",
            { event: "walletSwitch", data: { address: "addr-wallet-1" } },
            tabId,
          ),
        );
      }
      expect(sendMessage).not.toHaveBeenCalledWith("providerEvent", { event: "disconnect", data: {} }, expect.anything());
      await expect(providerCall({ origin: "https://b.example", method: "getActiveAddress", params: {} })).resolves.toBe(
        "addr-wallet-1",
      );
    });

    it("deleting a wallet still rejects the approvals waiting on it", async () => {
      await seed(["wallet-1", "wallet-2"], "wallet-2");
      const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]) });
      const call = providerCall({ origin: "https://a.example", method: "signature", params });
      const rejected = expect(call).rejects.toThrow(/wallet was removed/i);
      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());

      await deleteWallet("wallet-2");

      await rejected;
      expect(await getItem("session:pendingApprovals")).toEqual([]);
    });

    it("deleting the last wallet revokes every grant and disconnects those sites", async () => {
      await seed(["wallet-1"], "wallet-1");

      await deleteWallet("wallet-1");

      expect(await grantOrigins()).toEqual([]);
      for (const tabId of [1, 2]) {
        await vi.waitFor(() =>
          expect(sendMessage).toHaveBeenCalledWith("providerEvent", { event: "disconnect", data: {} }, tabId),
        );
      }
      expect(sendMessage).not.toHaveBeenCalledWith(
        "providerEvent",
        expect.objectContaining({ event: "walletSwitch" }),
        expect.anything(),
      );
    });
  });

  describe("granted permissions gate every provider method", () => {
    const ORIGIN = "https://bazar.arweave.net";
    const GATED = PROVIDER_METHODS.filter((method) => METHOD_PERMISSIONS[method].length > 0);

    async function seedGrant(permissions: PermissionType[]): Promise<void> {
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-1");
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions, createdAt: 0, expiresAt: null, budget: null },
      ]);
    }

    beforeEach(() => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    });

    it.each(GATED)("%s is refused, before any window opens, when the grant lacks its permissions", async (method) => {
      const required = METHOD_PERMISSIONS[method];
      await seedGrant(PERMISSION_TYPES.filter((permission) => !required.includes(permission)));

      await expect(providerCall({ origin: ORIGIN, method, params: {} })).rejects.toThrow(
        `Missing permission(s) for "${method}": ${required.join(", ")}`,
      );
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it.each(GATED)("%s gets past the gate when the grant has exactly its permissions", async (method) => {
      await seedGrant([...METHOD_PERMISSIONS[method]]);

      const call = providerCall({ origin: ORIGIN, method, params: {} });
      const outcome = await Promise.race([
        call.then(
          () => "resolved",
          (error: Error) => error.message,
        ),
        vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled()).then(() => "approval window"),
      ]);
      expect(outcome).not.toMatch(/missing permission/i);
    });

    it("names only the missing permissions when the grant covers part of a method", async () => {
      await seedGrant(["ACCESS_ADDRESS"]);
      await expect(providerCall({ origin: ORIGIN, method: "getBalances", params: {} })).rejects.toThrow(
        'Missing permission(s) for "getBalances": ACCESS_TOKENS',
      );
    });

    it.each(["getPermissions", "disconnect"] as const)("%s needs no permission", async (method) => {
      await seedGrant([]);
      await expect(providerCall({ origin: ORIGIN, method, params: {} })).resolves.not.toThrow();
    });
  });

  describe("senders are checked against Chrome's sender, not the message body", () => {
    const ORIGIN = "https://bazar.arweave.net";

    beforeEach(async () => {
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-1");
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
      ]);
    });

    function call(method: string, data: unknown, sender: Sender): Promise<unknown> {
      return (async () => rawHandlers.get(method)!({ data, sender }))();
    }

    it("providerCall uses the sender's origin and ignores an origin claimed in the body", async () => {
      const data = { origin: ORIGIN, method: "getActiveAddress", params: {} };
      await expect(call("providerCall", data, contentSender("https://evil.example"))).rejects.toThrow(
        '"https://evil.example" is not connected',
      );
      await expect(call("providerCall", data, contentSender(ORIGIN))).resolves.toBe("addr-1");
    });

    it.each<[string, Sender]>([
      ["an extension page", POPUP_SENDER],
      ["a sub-frame", { ...contentSender(ORIGIN), frameId: 3 }],
      ["a sender with no tab", { url: `${ORIGIN}/app` }],
      ["a non-http page", { url: "file:///tmp/x.html", frameId: 0, tab: { id: 7 } }],
    ])("providerCall from %s is rejected", async (_label, sender) => {
      await expect(call("providerCall", { method: "getActiveAddress", params: {} }, sender)).rejects.toThrow(
        /only accepted from a web page's content script/,
      );
    });

    it("every other method is rejected from a content script, before its handler runs", async () => {
      const guarded = [...rawHandlers.keys()].filter((method) => method !== "providerCall");
      expect(guarded).toEqual(expect.arrayContaining(["exportWallet", "createWallet", "resolveApproval", "getApproval"]));
      for (const method of guarded) {
        await expect(call(method, { walletId: "wallet-1", requestId: "r", approved: true }, contentSender(ORIGIN)), method)
          .rejects.toThrow(/can only be called from the Gleam extension/);
      }
      expect(store.get("local:wallets")).toHaveLength(1);
    });

    it("another extension's page is rejected", async () => {
      await expect(call("getState", undefined, { url: "chrome-extension://other/popup.html" })).rejects.toThrow(
        /can only be called from the Gleam extension/,
      );
    });

    it("an extension page opened in a tab, such as the approval window, is accepted", async () => {
      const sender = { url: "chrome-extension://test/approval.html", frameId: 0, tab: { id: 9 } };
      await expect(call("getState", undefined, sender)).resolves.toMatchObject({
        wallets: [expect.objectContaining({ id: "wallet-1" })],
      });
    });
  });
});
