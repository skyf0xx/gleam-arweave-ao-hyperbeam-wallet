import { describe, expect, it, vi, beforeEach } from "vitest";
import { REQUEST, RESPONSE } from "@gleam/messaging/src/page-protocol.ts";

const sendMessage = vi.fn();
const injectScript = vi.fn().mockResolvedValue({ script: document.createElement("script") });

vi.mock("@webext-core/messaging", () => ({
  defineExtensionMessaging: () => ({ sendMessage, onMessage: vi.fn() }),
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

describe("content.ts: page <-> background relay (ARCHITECTURE.md §4.3/§4.4)", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMessage.mockReset();
    injectScript.mockClear();
  });

  it("injects provider.js at document_start, top frame only, keepInDom: false", async () => {
    const contentScript = (await import("./index")).default;

    expect(contentScript.matches).toEqual(["http://*/*", "https://*/*"]);
    expect(contentScript.runAt).toBe("document_start");
    expect(contentScript.allFrames).toBe(false);

    await contentScript.main!({} as never);

    expect(injectScript).toHaveBeenCalledWith("/provider.js", { keepInDom: false });
  });

  it("relays a page REQUEST envelope to providerCall with location.origin attached", async () => {
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
      origin: location.origin,
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
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores a RESPONSE-typed message (only relays REQUEST envelopes)", async () => {
    const contentScript = (await import("./index")).default;
    await contentScript.main!({} as never);

    postPageRequest({ type: RESPONSE, id: "req-4", result: "x" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
