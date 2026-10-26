import { describe, expect, it, vi } from "vitest";
import type { DappViewMessage, DappViewNavigation } from "@gleam/dapp-view";
import {
  EVENT,
  OTHER_WALLET,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
} from "@gleam/messaging/src/page-protocol.ts";
import { createRuntime } from "@gleam/runtime/src/create-runtime.ts";
import { createInMemoryPlatform } from "@gleam/runtime/testing/index.ts";
import { createRuntimeHost } from "../worker/host";
import { attestedOrigin, createDappBridge, type DappViewBridgePlugin, type PageRuntime } from "./dapp-bridge";

const DAPP = "https://dapp.example";

/**
 * The native plugin as the bridge sees it: it relays whatever it is told,
 * and delivers a reply only when the page is still on `targetOrigin`.
 */
function fakeDappView(pageOrigin = DAPP) {
  const listeners = new Map<string, (event: unknown) => void>();
  const page = { origin: pageOrigin };
  const posted: Array<{ envelope: Record<string, unknown>; targetOrigin: string; delivered: boolean }> = [];
  const plugin = {
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    postMessage: vi.fn(async ({ data, targetOrigin }: { data: string; targetOrigin: string }) => {
      const delivered = targetOrigin === page.origin;
      posted.push({ envelope: JSON.parse(data) as Record<string, unknown>, targetOrigin, delivered });
      return { delivered };
    }),
    addListener: vi.fn(async (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
      return { remove: async () => {} };
    }),
  };
  return {
    plugin: plugin as unknown as DappViewBridgePlugin,
    page,
    posted,
    message(message: Partial<Omit<DappViewMessage, "data">> & { data: unknown }) {
      listeners.get("message")?.({ origin: page.origin, isMainFrame: true, ...message });
    },
    navigate(url: string) {
      page.origin = new URL(url).origin;
      listeners.get("navigation")?.({ url, canGoBack: false, loading: false } satisfies DappViewNavigation);
    },
  };
}

function bridge(runtime: Partial<PageRuntime> = {}, pageOrigin?: string) {
  const full: PageRuntime = { pageCall: vi.fn(async () => "result"), tabClosed: vi.fn(async () => {}), ...runtime };
  const view = fakeDappView(pageOrigin);
  const dapps = createDappBridge({ plugin: view.plugin, runtime: full, providerScript: "/* provider */" });
  return { view, dapps, runtime: full };
}

const request = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ type: REQUEST, id: "call-1", method: "getActiveAddress", params: {}, ...fields });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("attestedOrigin", () => {
  it("accepts an http(s) origin from the main frame", () => {
    expect(attestedOrigin({ origin: DAPP, isMainFrame: true, data: "" })).toBe(DAPP);
    expect(attestedOrigin({ origin: "http://localhost:5173", isMainFrame: true, data: "" })).toBe("http://localhost:5173");
  });

  it("drops a subframe, even on an http(s) origin", () => {
    expect(attestedOrigin({ origin: DAPP, isMainFrame: false, data: "" })).toBeNull();
  });

  it.each(["null", "file://", "file:///index.html", "data:text/html,hi", "about:blank", "chrome-extension://abcdef", "capacitor://localhost", "javascript:alert(1)", ""])(
    "drops the non-http(s) origin %j",
    (origin) => {
      expect(attestedOrigin({ origin, isMainFrame: true, data: "" })).toBeNull();
    },
  );

  it.each([`${DAPP}/`, `${DAPP}/path`, `${DAPP}?q`, "HTTPS://DAPP.EXAMPLE", `${DAPP}:443`, " https://dapp.example"])(
    "drops %j, which isn't an origin in its exact form",
    (origin) => {
      expect(attestedOrigin({ origin, isMainFrame: true, data: "" })).toBeNull();
    },
  );
});

describe("createDappBridge", () => {
  it("answers a main-frame request with the runtime's result, addressed to the reporting origin", async () => {
    const { view, runtime } = bridge();
    view.message({ data: request() });
    await settle();
    expect(runtime.pageCall).toHaveBeenCalledWith("providerCall", { method: "getActiveAddress", params: {} }, DAPP, undefined);
    expect(view.posted).toEqual([
      { envelope: { type: RESPONSE, id: "call-1", result: "result" }, targetOrigin: DAPP, delivered: true },
    ]);
  });

  it("answers with the runtime's error message", async () => {
    const { view } = bridge({ pageCall: vi.fn(async () => Promise.reject(new Error("Not connected."))) });
    view.message({ data: request() });
    await settle();
    expect(view.posted[0]?.envelope).toEqual({ type: RESPONSE, id: "call-1", error: { message: "Not connected." } });
  });

  it("takes the origin from native, never from the message", async () => {
    const { view, runtime } = bridge();
    view.message({ data: request({ origin: "https://wallet.example", params: { origin: "https://bank.example" } }) });
    await settle();
    expect(runtime.pageCall).toHaveBeenCalledWith(
      "providerCall",
      { method: "getActiveAddress", params: { origin: "https://bank.example" } },
      DAPP,
      undefined,
    );
    expect(view.posted[0]?.targetOrigin).toBe(DAPP);
  });

  it.each([
    ["a subframe", { isMainFrame: false, data: request() }],
    ["an opaque origin", { origin: "null", data: request() }],
    ["a file: origin", { origin: "file://", data: request() }],
    ["an origin with a trailing slash", { origin: `${DAPP}/`, data: request() }],
    ["malformed JSON", { data: "{not json" }],
    ["a non-string message", { data: { type: REQUEST, id: "call-1", method: "getActiveAddress" } }],
    ["JSON that isn't an object", { data: "[1,2]" }],
    ["JSON null", { data: "null" }],
    ["a request with no id", { data: request({ id: 7 }) }],
    ["a method outside the provider surface", { data: request({ method: "exportKeyfile" }) }],
    ["an unknown envelope", { data: JSON.stringify({ type: "GLEAM_SOMETHING" }) }],
  ])("drops %s without calling the runtime or replying", async (_label, message) => {
    const { view, runtime } = bridge();
    view.message(message);
    await settle();
    expect(runtime.pageCall).not.toHaveBeenCalled();
    expect(view.posted).toEqual([]);
  });

  it("keeps a reply addressed to the old origin when the page navigates before it is ready", async () => {
    let answer: (value: unknown) => void = () => {};
    const { view } = bridge({ pageCall: () => new Promise((resolve) => (answer = resolve)) });
    view.navigate(`${DAPP}/app`);
    view.message({ data: request() });
    await settle();
    view.navigate("https://other.example/");
    answer("secret-address");
    await settle();
    expect(view.posted).toEqual([
      { envelope: { type: RESPONSE, id: "call-1", result: "secret-address" }, targetOrigin: DAPP, delivered: false },
    ]);
  });

  it("answers a site-mode request, and falls back to the other wallet when the runtime fails", async () => {
    const pageCall = vi.fn().mockResolvedValueOnce({ useGleam: true }).mockRejectedValueOnce(new Error("locked"));
    const { view, runtime } = bridge({ pageCall });
    view.message({ data: JSON.stringify({ type: SITE_MODE_REQUEST }) });
    await settle();
    view.navigate("https://other.example/");
    view.message({ data: JSON.stringify({ type: SITE_MODE_REQUEST }) });
    await settle();
    expect(runtime.pageCall).toHaveBeenCalledWith("getSiteWalletMode", undefined, DAPP, undefined);
    expect(view.posted.map(({ envelope, targetOrigin }) => [envelope, targetOrigin])).toEqual([
      [{ type: SITE_MODE, useGleam: true }, DAPP],
      [{ type: SITE_MODE, useGleam: false }, "https://other.example"],
    ]);
  });

  it("reports another wallet with the page's tab only while that tab shows the reporting origin", async () => {
    const { view, runtime } = bridge();
    const report = JSON.stringify({ type: OTHER_WALLET, walletName: "Wander", used: true, permissions: ["SIGN_TRANSACTION"] });
    view.navigate(`${DAPP}/`);
    view.message({ data: report });
    view.navigate("https://other.example/");
    view.page.origin = DAPP;
    view.message({ data: report });
    await settle();
    const data = { walletName: "Wander", used: true, permissions: ["SIGN_TRANSACTION"] };
    expect(runtime.pageCall).toHaveBeenNthCalledWith(1, "reportOtherWallet", data, DAPP, 1);
    expect(runtime.pageCall).toHaveBeenNthCalledWith(2, "reportOtherWallet", data, DAPP, undefined);
    expect(view.posted).toEqual([]);
  });

  it("relays a site-mode request once per page, again after a cross-origin navigation", async () => {
    const { view, runtime } = bridge({ pageCall: vi.fn(async () => ({ useGleam: false })) });
    const ask = JSON.stringify({ type: SITE_MODE_REQUEST });
    view.navigate(`${DAPP}/`);
    view.message({ data: ask });
    view.message({ data: ask });
    await settle();
    view.navigate("https://other.example/");
    view.message({ data: ask });
    await settle();
    expect(vi.mocked(runtime.pageCall).mock.calls.map(([, , origin, tabId]) => [origin, tabId])).toEqual([
      [DAPP, 1],
      ["https://other.example", 2],
    ]);
  });

  it("relays each other-wallet report once per page, and each distinct permission list once", async () => {
    const { view, runtime } = bridge();
    const report = (fields: Record<string, unknown>) =>
      view.message({ data: JSON.stringify({ type: OTHER_WALLET, walletName: "Wander", ...fields }) });
    view.navigate(`${DAPP}/`);
    report({ used: false });
    report({ used: false });
    report({ used: true });
    report({ used: true });
    report({ used: true, permissions: ["ACCESS_ADDRESS"] });
    report({ used: true, permissions: ["ACCESS_ADDRESS"] });
    report({ used: true, permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"] });
    await settle();
    expect(vi.mocked(runtime.pageCall).mock.calls.map(([, data]) => data)).toEqual([
      { walletName: "Wander", used: false, permissions: undefined },
      { walletName: "Wander", used: true, permissions: undefined },
      { walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS"] },
      { walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS", "SIGN_TRANSACTION"] },
    ]);
  });

  it("tells the runtime a tab is gone when a cross-origin load or close replaces it", async () => {
    const { view, dapps, runtime } = bridge();
    view.navigate(`${DAPP}/`);
    view.navigate(`${DAPP}/swap`);
    expect(runtime.tabClosed).not.toHaveBeenCalled();
    view.navigate("https://other.example/");
    expect(runtime.tabClosed).toHaveBeenCalledExactlyOnceWith(1);
    await dapps.close();
    expect(view.plugin.close).toHaveBeenCalledTimes(1);
    expect(runtime.tabClosed).toHaveBeenLastCalledWith(2);
    expect(await dapps.tabs.webTabs()).toEqual([]);
  });

  it("opens pages with the provider script", async () => {
    const { view, dapps } = bridge();
    const frame = { x: 0, y: 0, width: 1, height: 1 };
    await dapps.open({ url: DAPP, frame });
    expect(view.plugin.open).toHaveBeenCalledWith({ url: DAPP, frame, providerScript: "/* provider */" });
  });
});

describe("the dApp view as the runtime's tab", () => {
  it("is one web tab, the same across same-origin navigations", async () => {
    const { view, dapps } = bridge();
    expect(await dapps.tabs.webTabs()).toEqual([]);
    view.navigate(`${DAPP}/`);
    view.navigate(`${DAPP}/swap`);
    expect(await dapps.tabs.webTabs()).toEqual([{ id: 1, url: `${DAPP}/swap` }]);
    expect(await dapps.tabs.activeTab()).toEqual({ id: 1, url: `${DAPP}/swap` });
  });

  it("gets a new id on a cross-origin navigation, and none on a non-web page", async () => {
    const { view, dapps } = bridge();
    view.navigate(`${DAPP}/`);
    view.navigate("https://other.example/");
    expect(await dapps.tabs.webTabs()).toEqual([{ id: 2, url: "https://other.example/" }]);
    view.navigate("about:blank");
    expect(await dapps.tabs.webTabs()).toEqual([]);
    expect(await dapps.tabs.activeTab()).toBeUndefined();
  });

  it("pushes events and the site mode to the tab's origin", async () => {
    const { view, dapps } = bridge();
    view.navigate(`${DAPP}/`);
    await dapps.tabs.send(1, "providerEvent", { event: "walletSwitch", data: { address: "a" } });
    await dapps.tabs.send(1, "siteWalletMode", { useGleam: false });
    expect(view.posted).toEqual([
      { envelope: { type: EVENT, event: "walletSwitch", data: { address: "a" } }, targetOrigin: DAPP, delivered: true },
      { envelope: { type: SITE_MODE, useGleam: false }, targetOrigin: DAPP, delivered: true },
    ]);
  });

  it("refuses a push to a tab id the view has moved on from, or one native couldn't deliver", async () => {
    const { view, dapps } = bridge();
    view.navigate(`${DAPP}/`);
    view.navigate("https://other.example/");
    await expect(dapps.tabs.send(1, "providerEvent", { event: "disconnect", data: {} })).rejects.toThrow(/no longer open/);
    expect(view.posted).toEqual([]);

    view.page.origin = "https://elsewhere.example";
    await expect(dapps.tabs.send(2, "providerEvent", { event: "disconnect", data: {} })).rejects.toThrow(/no longer open/);
    expect(view.posted[0]?.targetOrigin).toBe("https://other.example");
  });

  it("reloads only the current tab", async () => {
    const { view, dapps } = bridge();
    view.navigate(`${DAPP}/`);
    await dapps.tabs.reload(2);
    expect(view.plugin.reload).not.toHaveBeenCalled();
    await dapps.tabs.reload(1);
    expect(view.plugin.reload).toHaveBeenCalledTimes(1);
  });
});

describe("the bridge in front of the real dispatcher", () => {
  function wired(pageOrigin: string) {
    const runtime = createRuntime(createInMemoryPlatform());
    const host = createRuntimeHost(runtime, { onResume: () => {} });
    return bridge(host, pageOrigin);
  }

  it("refuses a plain-http site that isn't loopback, as the extension does", async () => {
    const { view } = wired("http://dapp.example");
    view.message({ data: request({ method: "connect", params: { permissions: ["ACCESS_ADDRESS"] } }) });
    await vi.waitFor(() => expect(view.posted).toHaveLength(1));
    expect(view.posted[0]).toEqual({
      envelope: { type: RESPONSE, id: "call-1", error: { message: "Gleam only works with secure (https) sites." } },
      targetOrigin: "http://dapp.example",
      delivered: true,
    });
  });

  it("holds an https site to its grant", async () => {
    const { view } = wired(DAPP);
    view.message({ data: request() });
    await vi.waitFor(() => expect(view.posted).toHaveLength(1));
    expect(view.posted[0]?.envelope).toEqual({
      type: RESPONSE,
      id: "call-1",
      error: { message: `"${DAPP}" is not connected. Call connect() first.` },
    });
  });
});
