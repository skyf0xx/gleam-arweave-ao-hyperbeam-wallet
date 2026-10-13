import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { EVENT, OTHER_WALLET, REQUEST, RESPONSE, SITE_MODE, SITE_MODE_REQUEST } from "@gleam/messaging/src/page-protocol.ts";

type Handler = (message: { data: unknown }) => unknown;
const registeredHandlers = new Map<string, Handler>();
const sendMessage = vi.fn();
const onMessage = vi.fn((type: string, handler: Handler) => {
  registeredHandlers.set(type, handler);
  return () => registeredHandlers.delete(type);
});
const injectScript = vi.fn().mockResolvedValue({ script: document.createElement("script") });

vi.mock("@webext-core/messaging", () => ({
  defineExtensionMessaging: () => ({ sendMessage, onMessage }),
}));
vi.mock("wxt/utils/inject-script", () => ({ injectScript }));

/**
 * `content.ts` calls `defineExtensionMessaging` at module scope, so the
 * mock must be registered (and modules reset) before each dynamic
 * import — the same pattern `adapters/runtime.unlock.test.ts` already
 * established for the identical reason.
 *
 * `postPageRequest` dispatches a synthetic `MessageEvent` with `source`
 * explicitly set to `window`, rather than calling the real
 * `window.postMessage` — jsdom's own `postMessage` always delivers
 * `event.source === null` (a jsdom limitation, not browser-accurate
 * behavior), which would make every test below indistinguishable from a
 * forged cross-origin message under `content.ts`'s own
 * `event.source !== window` guard. See `provider.provider.test.ts`'s
 * identical note for the same reasoning.
 */
function postPageRequest(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data, source: window }));
}

describe("content.ts: page <-> background relay", () => {
  // Each test imports a fresh copy of the script, so the window listeners
  // an earlier copy added are removed to keep it from answering too.
  const added: Array<[string, EventListenerOrEventListenerObject]> = [];
  const realAddEventListener = window.addEventListener.bind(window);

  beforeEach(() => {
    vi.spyOn(window, "addEventListener").mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      added.push([type, listener]);
      realAddEventListener(type, listener, options);
    }) as typeof window.addEventListener);
  });

  afterEach(() => {
    for (const [type, listener] of added.splice(0)) window.removeEventListener(type, listener);
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.resetModules();
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    injectScript.mockClear();
    registeredHandlers.clear();
    onMessage.mockClear();
  });

  it("injects provider.js at document_start, top frame only, keepInDom: false", async () => {
    const contentScript = (await import("./index")).default;

    expect(contentScript.matches).toEqual(["http://*/*", "https://*/*"]);
    expect(contentScript.runAt).toBe("document_start");
    expect(contentScript.allFrames).toBe(false);

    await contentScript.main!({} as never);

    expect(injectScript).toHaveBeenCalledWith("/provider.js", { keepInDom: false });
  });

  it("relays a page REQUEST envelope to providerCall without claiming an origin", async () => {
    sendMessage.mockResolvedValue("resolved-value");
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    const responseSpy = vi.fn();
    window.addEventListener("message", (event) => {
      if ((event.data as { type?: string })?.type === RESPONSE) responseSpy(event.data);
    });

    postPageRequest({ type: REQUEST, id: "req-1", method: "getActiveAddress", params: {} });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage).toHaveBeenCalledWith("providerCall", {
      method: "getActiveAddress",
      params: {},
    });

    await vi.waitFor(() => expect(responseSpy).toHaveBeenCalled());
    expect(responseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: RESPONSE, id: "req-1", result: "resolved-value" }),
    );
  });

  it("relays a background rejection back as an error envelope, never throwing", async () => {
    sendMessage.mockRejectedValue(new Error("not connected"));
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    const responseSpy = vi.fn();
    window.addEventListener("message", (event) => {
      if ((event.data as { type?: string })?.type === RESPONSE) responseSpy(event.data);
    });

    postPageRequest({ type: REQUEST, id: "req-2", method: "sign", params: {} });

    await vi.waitFor(() => expect(responseSpy).toHaveBeenCalled());
    expect(responseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: RESPONSE, id: "req-2", error: { message: "not connected" } }),
    );
  });

  it("ignores a message whose method is not a real PROVIDER_SURFACE_METHODS entry", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    postPageRequest({ type: REQUEST, id: "req-3", method: "createWallet", params: {} });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).not.toHaveBeenCalledWith("providerCall", expect.anything());
  });

  it("ignores a RESPONSE-typed message (only relays REQUEST envelopes)", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    postPageRequest({ type: RESPONSE, id: "req-4", result: "x" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).not.toHaveBeenCalledWith("providerCall", expect.anything());
  });

  /**
   * PROVIDER-EVENTS-ACCOUNT-SWITCH-PROVIDER-BRIDGE: the background ->
   * content half of `ProtocolMap.providerEvent`. Access control (only a
   * connected origin's tab is ever targeted) is enforced by the background
   * sender choosing which tabId to push to, not by this content script —
   * receiving the message at all already means this tab was targeted, so
   * relaying straight into `postProviderEvent` is correct here.
   */
  it("registers a providerEvent handler that relays event/data into postProviderEvent", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    expect(onMessage).toHaveBeenCalledWith("providerEvent", expect.any(Function));

    const eventSpy = vi.fn();
    window.addEventListener("message", (event) => {
      if ((event.data as { type?: string })?.type === EVENT) eventSpy(event.data);
    });

    const handler = registeredHandlers.get("providerEvent")!;
    handler({ data: { event: "walletSwitch", data: { address: "addr-1" } } });

    await vi.waitFor(() => expect(eventSpy).toHaveBeenCalled());
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: EVENT, event: "walletSwitch", data: { address: "addr-1" } }),
    );
  });
  function siteModeSpy() {
    const spy = vi.fn();
    window.addEventListener("message", (event) => {
      if ((event.data as { type?: string })?.type === SITE_MODE) spy(event.data);
    });
    return spy;
  }

  it("doesn't wake the background on load", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("answers the provider's site mode request once", async () => {
    sendMessage.mockImplementation(async (type: string) => (type === "getSiteWalletMode" ? { useGleam: true } : undefined));
    const spy = siteModeSpy();
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    postPageRequest({ type: SITE_MODE_REQUEST });
    postPageRequest({ type: SITE_MODE_REQUEST });

    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith({ type: SITE_MODE, useGleam: true }));
    expect(sendMessage.mock.calls.filter(([type]) => type === "getSiteWalletMode")).toHaveLength(1);
  });

  it("tells the page to use the other wallet when the background can't answer", async () => {
    sendMessage.mockRejectedValue(new Error("Could not establish connection."));
    const spy = siteModeSpy();
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    postPageRequest({ type: SITE_MODE_REQUEST });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith({ type: SITE_MODE, useGleam: false }));
  });

  it("relays each kind of other-wallet report only once per page", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    for (let i = 0; i < 3; i += 1) {
      postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: false });
      postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: true });
    }

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(sendMessage).toHaveBeenCalledWith("reportOtherWallet", { walletName: "Wander", used: false });
    expect(sendMessage).toHaveBeenCalledWith("reportOtherWallet", { walletName: "Wander", used: true });
  });

  it("relays each distinct permission list the page reports once", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: true });
    postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS"] });
    postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS"] });
    postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS", "SIGNATURE"] });
    postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: true, permissions: [42] });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
    expect(sendMessage).toHaveBeenCalledWith("reportOtherWallet", {
      walletName: "Wander",
      used: true,
      permissions: ["ACCESS_ADDRESS"],
    });
    expect(sendMessage).toHaveBeenCalledWith("reportOtherWallet", {
      walletName: "Wander",
      used: true,
      permissions: ["ACCESS_ADDRESS", "SIGNATURE"],
    });
  });

  it("relays the background's siteWalletMode push to the page", async () => {
    const spy = siteModeSpy();
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    registeredHandlers.get("siteWalletMode")!({ data: { useGleam: false } });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith({ type: SITE_MODE, useGleam: false }));
  });

  it("relays an other-wallet report from the page, listening before the provider is injected", async () => {
    injectScript.mockImplementationOnce(async () => {
      postPageRequest({ type: OTHER_WALLET, walletName: "Wander", used: false });
      return { script: document.createElement("script") };
    });
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith("reportOtherWallet", { walletName: "Wander", used: false }),
    );
  });

  it("ignores a malformed other-wallet report", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    postPageRequest({ type: OTHER_WALLET, walletName: 42, used: "yes" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).not.toHaveBeenCalledWith("reportOtherWallet", expect.anything());
  });
});
