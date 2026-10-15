import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateJWK, type JWKInterface } from "@gleam/core";

/**
 * The background's session-key housekeeping: dropping keys the keyring
 * holds without a session, clearing them on browser startup, and the
 * auto-lock alarm. `sessionKeyStore` is the in-memory `Keyring` from
 * `vitest.setup.ts`. Own minimal mocks, like `index.first-run-gateway.test.ts`.
 */

vi.mock("@webext-core/messaging", () => ({
  defineExtensionMessaging: () => ({ onMessage: vi.fn(() => () => {}), sendMessage: vi.fn() }),
}));

const store = new Map<string, unknown>();
vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
    removeItem: vi.fn(async (key: string) => void store.delete(key)),
    watch: vi.fn(() => () => {}),
  },
}));

const onStartupAddListener = vi.fn();
const onAlarmAddListener = vi.fn();
const alarmsCreate = vi.fn();
const alarmsGet = vi.fn<(name: string) => Promise<unknown>>(async () => undefined);
vi.mock("wxt/browser", () => ({
  browser: {
    windows: { create: vi.fn(), remove: vi.fn(), update: vi.fn(), onRemoved: { addListener: vi.fn() } },
    runtime: {
      getURL: (path: string) => `chrome-extension://test${path}`,
      onSuspend: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: onStartupAddListener },
      onMessageExternal: { addListener: vi.fn() },
    },
    tabs: { query: vi.fn().mockResolvedValue([]), onRemoved: { addListener: vi.fn() } },
    alarms: { create: alarmsCreate, get: alarmsGet, onAlarm: { addListener: onAlarmAddListener } },
  },
}));

vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (fn: () => void) => {
    fn();
    return { main: fn };
  },
}));

let jwk: JWKInterface;

beforeAll(async () => {
  jwk = await generateJWK();
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  store.clear();
  onStartupAddListener.mockClear();
  onAlarmAddListener.mockClear();
  alarmsCreate.mockClear();
  alarmsGet.mockReset();
  alarmsGet.mockResolvedValue(undefined);
});

/** Loads the background fresh, with the keyring instance it uses. */
async function loadBackground() {
  const { sessionKeyStore } = await import("@/src/adapters/session-key-store");
  await import("./index");
  return sessionKeyStore;
}

function unlockedSession(lastActivityAt: number, autoLockTimeout = "never") {
  store.set("session:unlockedSession", {
    unlockedAt: lastActivityAt,
    lastActivityAt,
    autoLockTimeout,
    unlockedWalletIds: ["wallet-a"],
  });
  store.set("session:key:wallet-a", { address: "addr-a", owner: jwk.n });
  store.set("session:cachedWalletIds", ["wallet-a"]);
}

describe("background.ts: session keys", () => {
  it("drops keys no session lists when the worker starts", async () => {
    const { sessionKeyStore } = await import("@/src/adapters/session-key-store");
    await sessionKeyStore.importKey("wallet-left-over", jwk);

    await import("./index");

    await vi.waitFor(async () => expect(await sessionKeyStore.has(["wallet-left-over"])).toEqual([]));
  });

  it("clears every session key and entry on browser startup", async () => {
    const sessionKeyStore = await loadBackground();
    unlockedSession(Date.now());
    await sessionKeyStore.importKey("wallet-a", jwk);

    const listener = onStartupAddListener.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(listener).toBeDefined();
    listener!();

    await vi.waitFor(async () => expect(await sessionKeyStore.has(["wallet-a"])).toEqual([]));
    expect(store.has("session:key:wallet-a")).toBe(false);
  });

  it("drops the keys on the auto-lock alarm once the timeout has passed", async () => {
    const sessionKeyStore = await loadBackground();
    await vi.waitFor(() => expect(alarmsCreate).toHaveBeenCalledWith("auto-lock", { periodInMinutes: 1 }));
    const onAlarm = onAlarmAddListener.mock.calls
      .map(([listener]) => listener as (alarm: { name: string }) => void);
    const tick = () => onAlarm.forEach((listener) => listener({ name: "auto-lock" }));

    unlockedSession(Date.now(), "5min");
    await sessionKeyStore.importKey("wallet-a", jwk);
    tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await sessionKeyStore.has(["wallet-a"])).toEqual(["wallet-a"]);

    unlockedSession(Date.now() - 5 * 60 * 1000 - 1, "5min");
    tick();

    await vi.waitFor(async () => expect(await sessionKeyStore.has(["wallet-a"])).toEqual([]));
    expect(store.has("session:unlockedSession")).toBe(false);
  });

  it("keeps an existing auto-lock alarm instead of restarting its period", async () => {
    alarmsGet.mockImplementation(async (name: string) => (name === "auto-lock" ? { name, periodInMinutes: 1 } : undefined));

    await loadBackground();

    await vi.waitFor(() => expect(alarmsGet).toHaveBeenCalledWith("auto-lock"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(alarmsCreate).not.toHaveBeenCalledWith("auto-lock", expect.anything());
  });
});
