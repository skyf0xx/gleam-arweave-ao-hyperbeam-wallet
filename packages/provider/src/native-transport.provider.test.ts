import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVENT,
  NATIVE_BRIDGE_EVENT,
  NATIVE_BRIDGE_HANDLER,
  OTHER_WALLET,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
} from "@gleam/messaging/src/page-protocol.ts";
import { createNativeBridgeTransport } from "./native-transport";

type BridgeWindow = Record<string, unknown>;

const teardown: AbortController[] = [];

afterEach(() => {
  for (const controller of teardown.splice(0)) controller.abort();
  const bridgeWindow = window as unknown as BridgeWindow;
  delete bridgeWindow.webkit;
  delete bridgeWindow[NATIVE_BRIDGE_HANDLER];
});

function transport() {
  const controller = new AbortController();
  teardown.push(controller);
  return createNativeBridgeTransport(controller.signal);
}

function iosHandler() {
  const handler = { postMessage: vi.fn() };
  (window as unknown as BridgeWindow).webkit = { messageHandlers: { [NATIVE_BRIDGE_HANDLER]: handler } };
  return handler;
}

function androidHandler() {
  const handler = { postMessage: vi.fn() };
  (window as unknown as BridgeWindow)[NATIVE_BRIDGE_HANDLER] = handler;
  return handler;
}

function reply(detail: unknown): void {
  window.dispatchEvent(new CustomEvent(NATIVE_BRIDGE_EVENT, { detail }));
}

const sent = (handler: { postMessage: ReturnType<typeof vi.fn> }) =>
  handler.postMessage.mock.calls.map(([text]) => JSON.parse(text as string) as Record<string, unknown>);

describe("createNativeBridgeTransport", () => {
  it("sends each request as JSON text through the iOS handler, with no origin", async () => {
    const handler = iosHandler();
    const call = transport().request("getActiveAddress", { a: 1 }, new AbortController().signal);
    expect(typeof handler.postMessage.mock.calls[0]?.[0]).toBe("string");
    const [request] = sent(handler);
    expect(Object.keys(request!).sort()).toEqual(["id", "method", "params", "type"]);
    expect(request).toMatchObject({ type: REQUEST, method: "getActiveAddress", params: { a: 1 } });

    reply(JSON.stringify({ type: RESPONSE, id: request!.id, result: "address" }));
    await expect(call).resolves.toBe("address");
  });

  it("uses the Android handler when there is no iOS one", () => {
    const handler = androidHandler();
    const bridge = transport();
    bridge.requestSiteMode();
    bridge.reportOtherWallet({ walletName: "Wander", used: true });
    expect(sent(handler)).toEqual([{ type: SITE_MODE_REQUEST }, { type: OTHER_WALLET, walletName: "Wander", used: true }]);
  });

  it("keeps sending through the handler and JSON it found at start when the page swaps them", () => {
    const original = vi.fn();
    const handler = { postMessage: original };
    (window as unknown as BridgeWindow)[NATIVE_BRIDGE_HANDLER] = handler;
    const bridge = transport();
    const swapped = { postMessage: vi.fn() };
    (window as unknown as BridgeWindow)[NATIVE_BRIDGE_HANDLER] = swapped;
    handler.postMessage = vi.fn();
    const stringify = vi.spyOn(JSON, "stringify").mockReturnValue("forged");
    try {
      bridge.requestSiteMode();
    } finally {
      stringify.mockRestore();
    }
    expect(swapped.postMessage).not.toHaveBeenCalled();
    expect(handler.postMessage).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledWith(JSON.stringify({ type: SITE_MODE_REQUEST }));
  });

  it("rejects a request when the page has no native handler", async () => {
    await expect(transport().request("connect", {}, new AbortController().signal)).rejects.toThrow(/can't reach/);
  });

  it("passes on events and the site mode, and ignores replies that aren't JSON envelopes", async () => {
    iosHandler();
    const bridge = transport();
    const events = vi.fn();
    const modes = vi.fn();
    bridge.onEvent(events);
    bridge.onSiteMode(modes);

    reply("{not json");
    reply({ type: EVENT, event: "connect", data: {} });
    reply(JSON.stringify(null));
    reply(JSON.stringify({ type: EVENT, event: "walletSwitch", data: { address: "a" } }));
    reply(JSON.stringify({ type: SITE_MODE, useGleam: true }));

    expect(events).toHaveBeenCalledExactlyOnceWith("walletSwitch", { address: "a" });
    expect(modes).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("settles a call once and forgets one the provider gave up on", async () => {
    const handler = iosHandler();
    const bridge = transport();
    const abort = new AbortController();
    const abandoned = bridge.request("sign", {}, abort.signal);
    const kept = bridge.request("sign", {}, new AbortController().signal);
    const [first, second] = sent(handler);
    abort.abort();
    let abandonedSettled = false;
    void abandoned.then(
      () => (abandonedSettled = true),
      () => (abandonedSettled = true),
    );

    reply(JSON.stringify({ type: RESPONSE, id: first!.id, result: "late" }));
    reply(JSON.stringify({ type: RESPONSE, id: second!.id, error: { message: "Refused." } }));
    reply(JSON.stringify({ type: RESPONSE, id: second!.id, result: "duplicate" }));
    await expect(kept).rejects.toThrow("Refused.");
    expect(abandonedSettled).toBe(false);
  });
});
