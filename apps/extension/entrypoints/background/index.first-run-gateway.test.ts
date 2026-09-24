import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Isolated test for background/index.ts's `initializeNetworkSettingsIfMissing`,
 * registered on `browser.runtime.onInstalled`. Kept out of
 * `index.test.ts` (which mocks `wxt/browser`'s `runtime` without
 * `onInstalled`) to avoid perturbing that large shared-mock suite; this
 * file adds its own minimal mocks instead.
 */

const registeredHandlers = new Map<string, () => unknown>();
const onMessage = vi.fn((type: string, handler: () => unknown) => {
  registeredHandlers.set(type, handler);
  return () => registeredHandlers.delete(type);
});
const sendMessage = vi.fn().mockResolvedValue(undefined);

vi.mock("@webext-core/messaging", () => ({
  defineExtensionMessaging: () => ({ onMessage, sendMessage }),
}));

const store = new Map<string, unknown>();
const getItem = vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null));
const setItem = vi.fn(async (key: string, value: unknown) => {
  store.set(key, value);
});
const removeItem = vi.fn(async (key: string) => {
  store.delete(key);
});
const watchFn = vi.fn(() => () => {});

vi.mock("wxt/utils/storage", () => ({
  storage: { getItem, setItem, removeItem, watch: watchFn },
}));

const onInstalledAddListener = vi.fn();

vi.mock("wxt/browser", () => ({
  browser: {
    windows: { create: vi.fn(), remove: vi.fn(), update: vi.fn(), onRemoved: { addListener: vi.fn() } },
    runtime: {
      getURL: (path: string) => `chrome-extension://test${path}`,
      onSuspend: { addListener: vi.fn() },
      onInstalled: { addListener: onInstalledAddListener },
    },
    tabs: { query: vi.fn().mockResolvedValue([]) },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  },
}));

vi.mock("wxt/utils/define-background", () => ({
  defineBackground: (fn: () => void) => {
    fn();
    return { main: fn };
  },
}));

const originalFetch = globalThis.fetch;

async function runOnInstalled(): Promise<void> {
  const listener = onInstalledAddListener.mock.calls[0]?.[0] as (() => void) | undefined;
  if (!listener) throw new Error("onInstalled listener was never registered.");
  listener();
  // The listener fires an unawaited async function; poll until it has
  // written (or definitively won't write) rather than guessing a fixed
  // number of microtask turns for its several sequential `await`s
  // (storage read, up to 3 gateway probes, the final storage write).
  for (let i = 0; i < 50 && setItem.mock.calls.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  // One more drain so the final `store.set` inside `setItem` has applied.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

const ARWEAVE_INFO = { network: "arweave.N.1" };

describe("background.ts: first-run gateway fallback", () => {
  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers.clear();
    onMessage.mockClear();
    sendMessage.mockClear();
    onInstalledAddListener.mockClear();
    getItem.mockClear();
    setItem.mockClear();
    removeItem.mockClear();
    store.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps arweave.net when it passes the gateway check", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(true, ARWEAVE_INFO)) as unknown as typeof fetch;
    await import("./index");
    await runOnInstalled();

    const settings = store.get("local:networkSettings") as { gatewayUrl: string } | undefined;
    expect(settings?.gatewayUrl).toBe("https://arweave.net");
  });

  it("falls back to a working AR.IO gateway when arweave.net fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://arweave.net/info") throw new Error("down");
      if (url === "https://ar-io.dev/info") return jsonResponse(true, ARWEAVE_INFO);
      return jsonResponse(true, { status: "ok" });
    }) as unknown as typeof fetch;
    await import("./index");
    await runOnInstalled();

    const settings = store.get("local:networkSettings") as { gatewayUrl: string } | undefined;
    expect(settings?.gatewayUrl).toBe("https://ar-io.dev");
  });

  it("keeps arweave.net when every candidate fails, and never throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await import("./index");
    await expect(runOnInstalled()).resolves.toBeUndefined();

    const settings = store.get("local:networkSettings") as { gatewayUrl: string } | undefined;
    expect(settings?.gatewayUrl).toBe("https://arweave.net");
  });

  it("never touches existing network settings", async () => {
    store.set("local:networkSettings", {
      gatewayUrl: "https://my-own-gateway.example.com",
      peers: [],
      activePeerUrl: null,
    });
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(true, ARWEAVE_INFO)) as unknown as typeof fetch;
    await import("./index");
    await runOnInstalled();

    expect(setItem).not.toHaveBeenCalledWith("local:networkSettings", expect.anything());
    const settings = store.get("local:networkSettings") as { gatewayUrl: string } | undefined;
    expect(settings?.gatewayUrl).toBe("https://my-own-gateway.example.com");
  });
});
