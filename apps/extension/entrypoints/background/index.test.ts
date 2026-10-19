import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  METHOD_PERMISSIONS,
  PERMISSION_TYPES,
  PROVIDER_METHODS,
  type JWKInterface,
  type PermissionType,
} from "@gleam/core";
import { generateJWK } from "@gleam/core/signer";
import { APPROVAL_GATED_METHODS, encodeTaggedBinary } from "@gleam/messaging/src/page-protocol.ts";

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
const tabsReload = vi.fn().mockResolvedValue(undefined);
const alarmsCreate = vi.fn();
const alarmsAddListener = vi.fn();
const onSuspendAddListener = vi.fn();
const setSessionAccessLevel = vi.fn(async () => undefined);
const downloadsDownload = vi.fn<(options: { url?: string; filename?: string }) => Promise<number>>(async () => 1);
const downloadsSearch = vi.fn(async () => [{ id: 1, state: "complete", filename: "/home/me/Downloads/main-arweave-keyfile.json" }]);
const downloadsErase = vi.fn(async () => [1]);
const permissionsContains = vi.fn(async () => true);
vi.mock("wxt/browser", () => ({
  browser: {
    downloads: {
      download: downloadsDownload,
      search: downloadsSearch,
      erase: downloadsErase,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    permissions: {
      contains: permissionsContains,
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: { session: { setAccessLevel: setSessionAccessLevel } },
    windows: { create: windowsCreate, remove: vi.fn(), update: vi.fn(), onRemoved: { addListener: vi.fn() } },
    runtime: { getURL: (path: string) => `chrome-extension://test${path}`, onSuspend: { addListener: onSuspendAddListener } },
    tabs: { query: tabsQuery, reload: tabsReload, onRemoved: { addListener: vi.fn() } },
    alarms: { create: alarmsCreate, get: vi.fn(async () => undefined), onAlarm: { addListener: alarmsAddListener } },
    action: { setIcon: vi.fn(async () => undefined) },
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

let sessionJwk: Promise<JWKInterface> | null = null;

/** Leaves what unlocking a wallet leaves: its session entry and its non-extractable keys. */
async function seedSessionKey(walletId: string, address: string): Promise<void> {
  sessionJwk ??= generateJWK();
  const { cacheKey } = await import("@/src/handlers/key-session");
  await cacheKey(walletId, await sessionJwk, address);
}

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
    tabsReload.mockClear();
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
      "addHardwareWallet",
      "downloadKeyfile",
      "getState",
      "resetAllWallets",
      "getPasskeyStatus",
      "checkVaultPassword",
      "enrollPasskey",
      "unlockWithPasskey",
      "removePasskey",
      "getApproval",
      "resolveApproval",
      "submitDeviceSignature",
      "deviceActivity",
      "getLockSettings",
      "setLockSettings",
      "getNetworkSettings",
      "setNetworkSettings",
      "getThemePreference",
      "setThemePreference",
      "revokeGrant",
      "getBalance",
      "getTokenBalances",
      "getCollectibles",
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

  it("unlocks with an enrolled passkey and forgets it on reset", async () => {
    const handler = (name: string) => registeredHandlers.get(name)!;
    const password = "correct horse battery staple";
    const prfOutput = "A".repeat(43);

    await handler("createWallet")({ data: { name: "Wallet 1", password } });
    await handler("enrollPasskey")({ data: { password, credentialId: "cred-1", prfSalt: "salt", prfOutput } });
    await handler("lockWallet")({ data: undefined });

    await expect(handler("unlockWithPasskey")({ data: { credentialId: "cred-1", prfOutput } })).resolves.toMatchObject({
      unlockedWalletIds: [expect.any(String)],
    });
    await expect(handler("getState")({ data: undefined })).resolves.toMatchObject({ session: expect.any(Object) });

    await handler("resetAllWallets")({ data: undefined });
    await expect(handler("getPasskeyStatus")({ data: undefined })).resolves.toEqual({ enrolled: false });
  });

  it("rejects downloadKeyfile routed through providerCall", () => {
    expect(() => providerCall({ origin: "https://evil.example", method: "downloadKeyfile", params: {} })).toThrow(
      /not reachable from a web page/i,
    );
  });

  it("downloadKeyfile saves the keyfile from the background and answers the popup with only the outcome", async () => {
    downloadsDownload.mockClear();
    const handler = (name: string) => registeredHandlers.get(name)!;
    const password = "correct horse battery staple";
    const created = (await handler("createWallet")({ data: { name: "Main", password } })) as { id: string };

    const result = await handler("downloadKeyfile")({ data: { walletId: created.id, password } });

    expect(result).toEqual({ ok: true, filename: "main-arweave-keyfile.json" });
    expect(downloadsDownload).toHaveBeenCalledOnce();
    const { url, filename } = downloadsDownload.mock.calls[0]![0];
    expect(filename).toBe("main-arweave-keyfile.json");
    const jwk = JSON.parse(atob(url!.slice("data:application/json;base64,".length))) as Record<string, string>;
    expect(jwk.kty).toBe("RSA");
    expect(jwk.d).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain(jwk.n!.slice(0, 32));
    expect(downloadsErase).toHaveBeenCalledWith({ id: 1 });
    const state = (await handler("getState")({ data: undefined })) as { wallets: Array<{ id: string; backupConfirmedAt: number | null }> };
    expect(state.wallets.find((wallet) => wallet.id === created.id)?.backupConfirmedAt).toEqual(expect.any(Number));
  });

  it("has no message that marks a backup without a download", () => {
    expect(rawHandlers.has("confirmWalletBackup")).toBe(false);
  });

  it("downloadKeyfile with the wrong password rejects without downloading", async () => {
    downloadsDownload.mockClear();
    const handler = (name: string) => registeredHandlers.get(name)!;
    const created = (await handler("createWallet")({
      data: { name: "Main", password: "correct horse battery staple" },
    })) as { id: string };

    await expect(
      handler("downloadKeyfile")({ data: { walletId: created.id, password: "wrong password entirely" } }),
    ).rejects.toThrow();
    expect(downloadsDownload).not.toHaveBeenCalled();
  });

  it("downloadKeyfile is refused from a page's content script before decrypting anything", async () => {
    downloadsDownload.mockClear();
    const handler = (name: string) => registeredHandlers.get(name)!;
    const password = "correct horse battery staple";
    const created = (await handler("createWallet")({ data: { name: "Main", password } })) as { id: string };
    const raw = rawHandlers.get("downloadKeyfile")!;

    await expect(
      (async () => raw({ data: { walletId: created.id, password }, sender: contentSender("https://evil.example") }))(),
    ).rejects.toThrow(/can only be called from the Gleam extension/);
    expect(downloadsDownload).not.toHaveBeenCalled();
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

  it("keeps the collectible send methods off the page: not via providerCall, not from a content script", () => {
    for (const method of ["estimateCollectibleSend", "sendCollectible"]) {
      expect(() => providerCall({ origin: "https://evil.example", method, params: {} })).toThrow(/not reachable from a web page/i);
      const handler = rawHandlers.get(method);
      expect(handler).toBeDefined();
      expect(() => handler!({ data: {}, sender: contentSender("https://evil.example") })).toThrow(
        /can only be called from the Gleam extension/,
      );
    }
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

  it("refuses privateHash for any site, before any grant check, without opening a window", () => {
    for (const origin of ["https://not-connected.example", "http://dapp.example"]) {
      expect(() => providerCall({ origin, method: "privateHash", params: {} })).toThrow(
        "privateHash is not supported. Use encrypt/decrypt instead.",
      );
    }
    expect(windowsCreate).not.toHaveBeenCalled();
  });

  describe("plain-http origins", () => {
    const HTTP_ORIGIN = "http://dapp.example";

    async function seedUnlockedWalletWithGrant(origin: string): Promise<void> {
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
      await seedSessionKey("wallet-1", "addr-1");
      await setItem("local:grants", [
        { origin, walletId: "wallet-1", permissions: [...PERMISSION_TYPES], createdAt: 0, expiresAt: null, budget: null },
      ]);
    }

    it.each(APPROVAL_GATED_METHODS)("refuses %s from a plain-http site before any window opens", (method) => {
      expect(() => providerCall({ origin: HTTP_ORIGIN, method, params: {} })).toThrow(
        "Gleam only works with secure (https) sites.",
      );
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it.each(["getActiveAddress", "getAllAddresses", "getActivePublicKey", "getWalletNames", "getPermissions", "getBalances", "getArweaveConfig"])(
      "refuses the read %s from a plain-http site that already holds a grant",
      async (method) => {
        await seedUnlockedWalletWithGrant(HTTP_ORIGIN);
        expect(() => providerCall({ origin: HTTP_ORIGIN, method, params: {} })).toThrow(
          "Gleam only works with secure (https) sites.",
        );
      },
    );

    it("refuses a read from a LAN or *.localhost plain-http origin", async () => {
      for (const origin of ["http://192.168.1.10", "http://foo.localhost:3000"]) {
        await seedUnlockedWalletWithGrant(origin);
        expect(() => providerCall({ origin, method: "getActiveAddress", params: {} })).toThrow(
          "Gleam only works with secure (https) sites.",
        );
      }
    });

    it("lets a plain-http site drop its own grant", async () => {
      await seedUnlockedWalletWithGrant(HTTP_ORIGIN);
      await expect(providerCall({ origin: HTTP_ORIGIN, method: "disconnect", params: {} })).resolves.toBeUndefined();
    });

    it("still answers reads for a granted loopback http site", async () => {
      await seedUnlockedWalletWithGrant("http://localhost:3000");
      await expect(
        providerCall({ origin: "http://localhost:3000", method: "getActiveAddress", params: {} }),
      ).resolves.toBe("addr-1");
    });

    it("refuses signing from a plain-http site that already holds a grant", async () => {
      await seedUnlockedWalletWithGrant(HTTP_ORIGIN);
      const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]) });

      expect(() => providerCall({ origin: HTTP_ORIGIN, method: "signature", params })).toThrow(
        "Gleam only works with secure (https) sites.",
      );
      expect(() => providerCall({ origin: HTTP_ORIGIN, method: "connect", params: {} })).toThrow(
        "Gleam only works with secure (https) sites.",
      );
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it.each(["http://localhost:3000", "http://127.0.0.1:5173", "http://[::1]:8080"])(
      "still lets local development at %s connect",
      async (origin) => {
        await seedUnlockedWalletWithGrant(origin);
        await expect(
          providerCall({ origin, method: "connect", params: { permissions: ["ACCESS_ADDRESS"] } }),
        ).resolves.toBeDefined();
        const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]) });
        void providerCall({ origin, method: "signature", params }).catch(() => undefined);
        await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
      },
    );

    it("a connected site's reads don't extend the session, but a Gleam page's getState does", async () => {
      await seedUnlockedWalletWithGrant("https://dapp.example");
      // A password vault, so auto-lock applies to the session.
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: { v: 2 } },
      ]);
      const stale = Date.now() - 60_000;
      await setItem("session:unlockedSession", {
        unlockedAt: stale,
        lastActivityAt: stale,
        autoLockTimeout: "5min",
        unlockedWalletIds: ["wallet-1"],
      });
      const lastActivity = () => (store.get("session:unlockedSession") as { lastActivityAt: number }).lastActivityAt;

      for (const method of ["getActiveAddress", "getAllAddresses", "getPermissions"]) {
        await providerCall({ origin: "https://dapp.example", method, params: {} });
      }
      expect(lastActivity()).toBe(stale);

      await registeredHandlers.get("getState")!({ data: undefined });
      expect(lastActivity()).toBeGreaterThan(stale);
    });

    it("an https site with a grant still reaches the approval window", async () => {
      await seedUnlockedWalletWithGrant("https://dapp.example");
      const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]) });
      void providerCall({ origin: "https://dapp.example", method: "signature", params }).catch(() => undefined);
      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    });
  });

  it("keeps session storage, where unlocked keys are cached, out of content scripts' reach", () => {
    expect(setSessionAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
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

  it("connect() carries the dApp's appInfo through to the approval preview", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");

    void providerCall({
      origin: "https://bazar.arweave.net",
      method: "connect",
      params: { permissions: ["ACCESS_ADDRESS"], appInfo: { name: "Bazar", logo: "https://bazar.arweave.net/logo.png" } },
    }).catch(() => undefined);

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    const pending = (await getItem("session:pendingApprovals")) as Array<{
      request: { preview: { appInfo: unknown } };
    }>;
    expect(pending[0]!.request.preview.appInfo).toEqual({ name: "Bazar", logo: "https://bazar.arweave.net/logo.png" });
  });

  it("connect() drops a malformed appInfo (non-string fields) rather than storing it", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");

    void providerCall({
      origin: "https://bazar.arweave.net",
      method: "connect",
      params: { permissions: ["ACCESS_ADDRESS"], appInfo: { name: 123, logo: null } },
    }).catch(() => undefined);

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    const pending = (await getItem("session:pendingApprovals")) as Array<{
      request: { preview: { appInfo: unknown } };
    }>;
    expect(pending[0]!.request.preview.appInfo).toBeNull();
  });

  it("connect() trims appInfo.name, drops an empty result to null, and caps its length at 64", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");

    void providerCall({
      origin: "https://bazar.arweave.net",
      method: "connect",
      params: { permissions: ["ACCESS_ADDRESS"], appInfo: { name: `  ${"A".repeat(80)}  `, logo: null } },
    }).catch(() => undefined);

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    const pending = (await getItem("session:pendingApprovals")) as Array<{
      request: { preview: { appInfo: { name: string | null; logo: string | null } | null } };
    }>;
    expect(pending[0]!.request.preview.appInfo).toEqual({ name: "A".repeat(64), logo: null });
  });

  it("connect() drops an all-whitespace appInfo.name to null instead of storing empty text", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");

    void providerCall({
      origin: "https://bazar.arweave.net",
      method: "connect",
      params: { permissions: ["ACCESS_ADDRESS"], appInfo: { name: "   ", logo: "https://bazar.arweave.net/logo.png" } },
    }).catch(() => undefined);

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    const pending = (await getItem("session:pendingApprovals")) as Array<{
      request: { preview: { appInfo: { name: string | null; logo: string | null } | null } };
    }>;
    expect(pending[0]!.request.preview.appInfo).toEqual({ name: null, logo: "https://bazar.arweave.net/logo.png" });
  });

  it("getArweaveConfig reflects the configured gateway instead of a hard-coded arweave.net", async () => {
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
    await seedSessionKey("wallet-1", "addr-1");
    await setItem("local:networkSettings", {
      gatewayUrl: "https://ar-io.dev",
      peers: [],
      activePeerUrl: null,
    });
    await setItem("local:grants", [
      {
        origin: "https://bazar.arweave.net",
        walletId: "wallet-1",
        permissions: ["ACCESS_ARWEAVE_CONFIG"],
        createdAt: 0,
        expiresAt: null,
        budget: null,
      },
    ]);

    await expect(
      providerCall({ origin: "https://bazar.arweave.net", method: "getArweaveConfig", params: {} }),
    ).resolves.toEqual({ protocol: "https", host: "ar-io.dev", port: 443 });
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
    await seedSessionKey("wallet-1", "addr-1");

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
    await seedSessionKey("wallet-1", "addr-1");

    // `previewWatchedToken`'s balance read for the amount's denomination —
    // a bare atomic-quantity string, the shape a live HyperBEAM node
    // actually returns (see `ao/balance.ts`'s `parseBalanceResponse`),
    // which resolves to AO's known denomination (12). Uses the real AO
    // process id so `isRegisteredProcessId` short-circuits the metadata
    // lookup this mocked fetch can't answer, matching what balances do
    // for a registered token.
    const fetchMock = vi.fn().mockResolvedValue(new Response("0", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const aoProcessId = "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc";

    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "transferAoTokens",
      params: { token: aoProcessId, recipient: "recipient-addr", amount: "1000" },
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
      token: aoProcessId,
      tokenDenomination: 12,
      // `withRegisteredTicker` overrides the bare-quantity response's
      // process-id-echoed ticker with AO's known "AO" ticker, since this
      // test uses the real registered AO process id.
      tokenTicker: "AO",
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

  it("transferAoTokens still opens the approval window when the denomination read fails", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");
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

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "transferAoTokens",
      params: { token: "ao-process-id", recipient: "recipient-addr", amount: "1000" },
    });
    resultPromise.catch(() => {});

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());

    const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{
      request: { preview: Record<string, unknown> };
    }>;
    expect(pendingRaw).toHaveLength(1);
    expect(pendingRaw[0]!.request.preview).toMatchObject({
      token: "ao-process-id",
      tokenDenomination: null,
      tokenTicker: null,
    });
  });

  it("transferAoTokens still opens the approval window (with an unresolved denomination) when the peer read hangs past the lookup timeout", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");
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

    vi.useFakeTimers();
    try {
      // Never resolves — simulates a hung HyperBEAM peer.
      globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

      const resultPromise = providerCall({
        origin: "https://bazar.arweave.net",
        method: "transferAoTokens",
        params: { token: "ao-process-id", recipient: "recipient-addr", amount: "1000" },
      });
      resultPromise.catch(() => {});

      // Advance past the lookup's own race timeout without waiting on real
      // wall-clock time, then let the window-open path proceed.
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled(), { timeout: 1000 });

      const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{
        request: { preview: Record<string, unknown> };
      }>;
      expect(pendingRaw).toHaveLength(1);
      expect(pendingRaw[0]!.request.preview).toMatchObject({
        token: "ao-process-id",
        tokenDenomination: null,
        tokenTicker: null,
      });
    } finally {
      vi.useRealTimers();
    }
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
   * The `sign`/`dispatch` preview's fee is what will actually be charged.
   * When the dApp's transaction leaves `reward` out, the dispatcher must
   * quote one from the gateway (mirroring `signTransaction`/
   * `dispatchTransaction`'s own arweave-js default) rather than showing
   * `null`/raw Winston with no fee at all.
   */
  it("sign quotes a fee from the gateway when the dApp's transaction omits reward", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");
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

    const fetchMock = vi.fn().mockResolvedValue(new Response("654321", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "sign",
      params: { transaction: { target: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", quantity: "1000" } },
    });
    resultPromise.catch(() => {});

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());

    const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{
      request: { requestId: string; preview: Record<string, unknown> };
    }>;
    expect(pendingRaw).toHaveLength(1);
    expect(pendingRaw[0]!.request.preview).toMatchObject({ fee: "654321" });

    const resolveApproval = registeredHandlers.get("resolveApproval")!;
    await resolveApproval({ data: { requestId: pendingRaw[0]!.request.requestId, approved: false } });
  });

  /**
   * arweave-js prices a transaction by its real `data.byteLength` when it
   * signs (see `signTransaction`/`dispatchTransaction`'s `buildTransaction`
   * passing the actual payload through). A quote fixed at 0 bytes would
   * underquote any non-empty payload — this proves the quote request's
   * URL carries the dApp's real data size, not a hardcoded 0.
   */
  it("sign's fee quote for a data-carrying transaction prices the actual payload size, not 0 bytes", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");
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

    const fetchMock = vi.fn().mockResolvedValue(new Response("999999999", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // 1000 bytes of payload, base64url-encoded (readTransaction decodes a
    // string `data` field the same way a real dApp's dispatch() call does).
    const payload = new Uint8Array(1000).fill(65);
    const base64Url = Buffer.from(payload).toString("base64url");

    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "sign",
      params: {
        transaction: {
          target: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          quantity: "1000",
          data: base64Url,
        },
      },
    });
    resultPromise.catch(() => {});

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());

    const priceUrl = fetchMock.mock.calls.map((call) => String(call[0])).find((url) => url.includes("/price/"));
    expect(priceUrl).toContain("/price/1000/");

    const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{
      request: { requestId: string; preview: Record<string, unknown> };
    }>;
    expect(pendingRaw[0]!.request.preview).toMatchObject({ fee: "999999999" });

    const resolveApproval = registeredHandlers.get("resolveApproval")!;
    await resolveApproval({ data: { requestId: pendingRaw[0]!.request.requestId, approved: false } });
  });

  it("sign uses the dApp's own reward as the fee, without quoting one from the gateway", async () => {
    await setItem("local:wallets", [
      { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
    ]);
    await setItem("local:activeWalletId", "wallet-1");
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

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = providerCall({
      origin: "https://bazar.arweave.net",
      method: "sign",
      params: { transaction: { target: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", quantity: "1000", reward: "999999" } },
    });
    resultPromise.catch(() => {});

    await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());

    const pendingRaw = (await getItem("session:pendingApprovals")) as Array<{
      request: { requestId: string; preview: Record<string, unknown> };
    }>;
    expect(pendingRaw).toHaveLength(1);
    expect(pendingRaw[0]!.request.preview).toMatchObject({ fee: "999999" });
    expect(fetchMock).not.toHaveBeenCalled();

    const resolveApproval = registeredHandlers.get("resolveApproval")!;
    await resolveApproval({ data: { requestId: pendingRaw[0]!.request.requestId, approved: false } });
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
      await seedSessionKey(walletId, address);
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
      await seedSessionKey("wallet-1", "addr-1");
      await seedSessionKey("wallet-2", "addr-2");
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

  describe("provider methods the active wallet can't do are refused before any window opens", () => {
    const ORIGIN = "https://bazar.arweave.net";

    async function seedHardwareWallet(method: "keystone" | "ledger"): Promise<void> {
      await setItem("local:wallets", [
        { id: "hw-1", address: "addr-hw", name: "Device", method, publicKey: "pub-hw", createdAt: 0, updatedAt: 0, encryptedKeyfile: null,
          device: method === "keystone" ? { kind: "keystone", xfp: "0a1b2c3d" } : { kind: "ledger" } },
      ]);
      await setItem("local:activeWalletId", "hw-1");
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "hw-1", permissions: [...PERMISSION_TYPES], createdAt: 0, expiresAt: null, budget: null },
      ]);
    }

    it.each([
      ["ledger", "signMessage", "sign messages"],
      ["ledger", "signature", "sign with the deprecated signature()"],
      ["ledger", "decrypt", "decrypt data"],
    ] as const)("%s refuses %s", async (walletMethod, method, action) => {
      await seedHardwareWallet(walletMethod);
      const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]) });

      await expect(providerCall({ origin: ORIGIN, method, params })).rejects.toThrow(
        `This wallet can't ${action}. Switch to a keyfile wallet.`,
      );
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it("a Keystone's signMessage with a hash other than SHA-256 is refused", async () => {
      await seedHardwareWallet("keystone");
      const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]), options: { hashAlgorithm: "SHA-384" } });

      await expect(providerCall({ origin: ORIGIN, method: "signMessage", params })).rejects.toThrow(
        "A hardware wallet signs messages with SHA-256 only, not SHA-384.",
      );
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it("a hardware wallet still reaches the approval window for what it can sign", async () => {
      await seedHardwareWallet("ledger");
      const params = encodeTaggedBinary({ data: new Uint8Array([1, 2, 3]), options: { name: "RSA-OAEP" } });
      void providerCall({ origin: ORIGIN, method: "encrypt", params }).catch(() => undefined);

      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
    });
  });

  describe("requests that could yield a Gleam Points proof are refused before any window opens", () => {
    const ORIGIN = "https://bazar.arweave.net";
    const POINTS_MESSAGE = "gleam-points:register:v1:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs:-:1700000000";
    const b64url = (text: string) => Buffer.from(text).toString("base64url");

    beforeEach(async () => {
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-1");
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions: [...PERMISSION_TYPES], createdAt: 0, expiresAt: null, budget: null },
      ]);
    });

    it.each(["SHA-256", "SHA-384", "SHA-512"])("signMessage of a points payload with %s", async (hashAlgorithm) => {
      const params = encodeTaggedBinary({ data: new TextEncoder().encode(POINTS_MESSAGE), options: { hashAlgorithm } });

      await expect(providerCall({ origin: ORIGIN, method: "signMessage", params })).rejects.toThrow(
        "Gleam Points messages can only be signed from Gleam itself.",
      );
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it.each(["sign", "dispatch"])("%s of a transaction with a Gleam-Points tag", async (method) => {
      const params = { transaction: { tags: [{ name: b64url("Gleam-Points"), value: b64url(POINTS_MESSAGE) }] } };

      await expect(providerCall({ origin: ORIGIN, method, params })).rejects.toThrow(
        "a Gleam-Points tag can only be signed from Gleam itself.",
      );
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it("a message that only mentions the prefix later still reaches the approval window", async () => {
      const params = encodeTaggedBinary({ data: new TextEncoder().encode(`Hello ${POINTS_MESSAGE}`) });
      void providerCall({ origin: ORIGIN, method: "signMessage", params }).catch(() => undefined);

      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
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
      await seedSessionKey("wallet-1", "addr-1");
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
        await seedSessionKey(id, `addr-${id}`);
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

  describe("routing a site between Gleam and another installed wallet", () => {
    const ORIGIN = "https://bazar.arweave.net";

    beforeEach(async () => {
      await setItem("local:wallets", [
        { id: "wallet-1", address: "addr-1", name: "Main", method: "jwk", publicKey: "pub", createdAt: 0, updatedAt: 0, encryptedKeyfile: null },
      ]);
      await setItem("local:activeWalletId", "wallet-1");
      tabsQuery.mockResolvedValue([{ id: 7, url: `${ORIGIN}/app` }]);
    });

    function fromContent(method: string, data: unknown, origin = ORIGIN): Promise<unknown> {
      return (async () => rawHandlers.get(method)!({ data, sender: contentSender(origin) }))();
    }

    it("a site uses the other wallet until it holds a grant", async () => {
      await expect(fromContent("getSiteWalletMode", undefined)).resolves.toEqual({ useGleam: false });
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
      ]);
      await expect(fromContent("getSiteWalletMode", undefined)).resolves.toEqual({ useGleam: true });
    });

    it("the popup sees the other wallet the active tab reported", async () => {
      await fromContent("reportOtherWallet", { walletName: "Wander", used: true });
      await expect(registeredHandlers.get("getActiveSite")!({ data: undefined })).resolves.toMatchObject({
        origin: ORIGIN,
        otherWallet: "Wander",
        otherWalletUsedAt: expect.any(Number),
        grant: null,
      });
    });

    it("Use Gleam here grants the chosen permissions, switches open tabs, and reloads the active one", async () => {
      await registeredHandlers.get("useGleamOnSite")!({
        data: { origin: ORIGIN, permissions: ["ACCESS_TOKENS", "NOT_A_PERMISSION"] },
      });

      expect(await getItem("local:grants")).toEqual([
        expect.objectContaining({ origin: ORIGIN, walletId: "wallet-1", permissions: ["ACCESS_ADDRESS", "ACCESS_TOKENS"] }),
      ]);
      expect(sendMessage).toHaveBeenCalledWith("siteWalletMode", { useGleam: true }, 7);
      expect(tabsReload).toHaveBeenCalledWith(7);
      expect(windowsCreate).not.toHaveBeenCalled();
    });

    it("doesn't reload the active tab when it has moved on to another site", async () => {
      tabsQuery.mockResolvedValue([{ id: 8, url: "https://other.example/" }]);
      await registeredHandlers.get("useGleamOnSite")!({ data: { origin: ORIGIN, permissions: [] } });
      expect(tabsReload).not.toHaveBeenCalled();
    });

    it("Switch back revokes the grant, hands open tabs back, and reloads the active one", async () => {
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
      ]);
      await registeredHandlers.get("stopGleamOnSite")!({ data: { origin: ORIGIN } });

      expect(await getItem("local:grants")).toEqual([]);
      expect(sendMessage).toHaveBeenCalledWith("providerEvent", { event: "disconnect", data: {} }, 7);
      expect(sendMessage).toHaveBeenCalledWith("siteWalletMode", { useGleam: false }, 7);
      expect(tabsReload).toHaveBeenCalledWith(7);
    });

    it("an approved connect marks the site as using Gleam and switches its open tabs", async () => {
      await setItem("session:unlockedSession", {
        unlockedAt: 0,
        lastActivityAt: 0,
        autoLockTimeout: "never",
        unlockedWalletIds: ["wallet-1"],
      });
      await seedSessionKey("wallet-1", "addr-1");

      const connecting = rawHandlers.get("providerCall")!({
        data: { method: "connect", params: { permissions: ["ACCESS_ADDRESS"] } },
        sender: contentSender(ORIGIN),
      });
      await vi.waitFor(() => expect(windowsCreate).toHaveBeenCalled());
      const pending = (await getItem("session:pendingApprovals")) as Array<{ request: { requestId: string } }>;
      await registeredHandlers.get("resolveApproval")!({ data: { requestId: pending[0]!.request.requestId, approved: true } });
      await connecting;

      await expect(fromContent("getSiteWalletMode", undefined)).resolves.toEqual({ useGleam: true });
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("siteWalletMode", { useGleam: true }, 7));
    });

    it("a dApp's own disconnect keeps the site on Gleam, so its next connect still comes to Gleam", async () => {
      await registeredHandlers.get("useGleamOnSite")!({ data: { origin: ORIGIN, permissions: [] } });
      sendMessage.mockClear();

      await rawHandlers.get("providerCall")!({ data: { method: "disconnect", params: {} }, sender: contentSender(ORIGIN) });

      expect(await getItem("local:grants")).toEqual([]);
      await expect(fromContent("getSiteWalletMode", undefined)).resolves.toEqual({ useGleam: true });
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("providerEvent", { event: "disconnect", data: {} }, 7));
      expect(sendMessage).not.toHaveBeenCalledWith("siteWalletMode", expect.anything(), expect.anything());
    });

    it("Switch back forgets the user's choice as well as the grant", async () => {
      await registeredHandlers.get("useGleamOnSite")!({ data: { origin: ORIGIN, permissions: [] } });
      await registeredHandlers.get("stopGleamOnSite")!({ data: { origin: ORIGIN } });
      await expect(fromContent("getSiteWalletMode", undefined)).resolves.toEqual({ useGleam: false });
    });

    it("resetting the vault sends every chosen site back to the other wallet", async () => {
      await registeredHandlers.get("useGleamOnSite")!({ data: { origin: ORIGIN, permissions: [] } });
      await registeredHandlers.get("resetAllWallets")!({ data: undefined });
      await expect(fromContent("getSiteWalletMode", undefined)).resolves.toEqual({ useGleam: false });
    });

    async function chooseGleamWithoutGrant(): Promise<void> {
      await registeredHandlers.get("useGleamOnSite")!({ data: { origin: ORIGIN, permissions: [] } });
      await rawHandlers.get("providerCall")!({ data: { method: "disconnect", params: {} }, sender: contentSender(ORIGIN) });
      sendMessage.mockClear();
    }

    it("resetting the vault switches back open tabs of a chosen site that holds no grant", async () => {
      await chooseGleamWithoutGrant();
      await registeredHandlers.get("resetAllWallets")!({ data: undefined });
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("siteWalletMode", { useGleam: false }, 7));
      expect(sendMessage).not.toHaveBeenCalledWith("providerEvent", expect.anything(), expect.anything());
    });

    it("deleting the last wallet switches back open tabs of a chosen site that holds no grant", async () => {
      await chooseGleamWithoutGrant();
      await registeredHandlers.get("deleteWallet")!({ data: { walletId: "wallet-1" } });
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("siteWalletMode", { useGleam: false }, 7));
      await expect(fromContent("getSiteWalletMode", undefined)).resolves.toEqual({ useGleam: false });
    });

    it("revoking from Connected apps hands open tabs back to the other wallet", async () => {
      await setItem("local:grants", [
        { origin: ORIGIN, walletId: "wallet-1", permissions: ["ACCESS_ADDRESS"], createdAt: 0, expiresAt: null, budget: null },
      ]);
      await registeredHandlers.get("revokeGrant")!({ data: { origin: ORIGIN } });
      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("siteWalletMode", { useGleam: false }, 7));
    });

    it.each(["useGleamOnSite", "stopGleamOnSite", "dismissSiteSuggestion"])("%s refuses an origin that isn't a web origin", async (method) => {
      await expect(
        (async () => registeredHandlers.get(method)!({ data: { origin: "chrome://settings", permissions: [] } }))(),
      ).rejects.toThrow(/web origin/);
    });

    it.each(["getSiteWalletMode", "reportOtherWallet"])("%s is refused from an extension page", async (method) => {
      await expect(
        (async () => rawHandlers.get(method)!({ data: { walletName: "Wander", used: true }, sender: POPUP_SENDER }))(),
      ).rejects.toThrow(/only accepted from a web page's content script/);
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
      const contentMethods = ["providerCall", "getSiteWalletMode", "reportOtherWallet"];
      const guarded = [...rawHandlers.keys()].filter((method) => !contentMethods.includes(method));
      expect(guarded).toEqual(
        expect.arrayContaining([
          "downloadKeyfile",
          "createWallet",
          "resolveApproval",
          "getApproval",
          "submitDeviceSignature",
          "deviceActivity",
        ]),
      );
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
