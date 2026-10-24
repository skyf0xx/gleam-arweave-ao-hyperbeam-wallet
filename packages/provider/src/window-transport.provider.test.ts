import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT,
  OTHER_WALLET,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
} from "@gleam/messaging/src/page-protocol.ts";
import { GleamProvider } from "./provider";
import type { ProviderTransport } from "./transport";
import { createWindowMessageTransport } from "./window-transport";

/**
 * Incoming messages are dispatched as synthetic `MessageEvent`s with
 * `source` set, rather than through the real `window.postMessage`: jsdom
 * always delivers `event.source === null` (a jsdom limitation; real
 * browsers set it to the posting window), which would make every
 * legitimate message indistinguishable from a forged one. The forged
 * cases dispatch with `source: null` on purpose.
 */
function post(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data, source: window }));
}

describe("createWindowMessageTransport", () => {
  let transportListener: AbortController;
  let transport: ProviderTransport;
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    transportListener = new AbortController();
    transport = createWindowMessageTransport(transportListener.signal);
    postMessageSpy = vi.spyOn(window, "postMessage");
  });

  afterEach(() => {
    transportListener.abort();
    postMessageSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  function posted(type: string) {
    return postMessageSpy.mock.calls
      .map(([message]: [unknown]) => message as { type?: string; id: string; method: string; params: unknown })
      .filter((message: { type?: string }) => message?.type === type);
  }

  function lastRequestEnvelope() {
    const request = posted(REQUEST).at(-1);
    if (!request) throw new Error("No REQUEST envelope was posted.");
    return request;
  }

  const send = (method: "getActiveAddress" | "connect" | "sign", params: unknown = {}, signal = new AbortController().signal) =>
    transport.request(method, params, signal);

  it("posts a REQUEST envelope with a fresh random id per call", async () => {
    const callPromise = send("getActiveAddress");
    const envelope = lastRequestEnvelope();
    expect(envelope).toEqual({ type: REQUEST, id: envelope.id, method: "getActiveAddress", params: {} });
    expect(envelope.id).toMatch(/^[0-9a-f]{32}$/);

    void send("getActiveAddress");
    const ids = posted(REQUEST).map((message: { id: string }) => message.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);

    post({ type: RESPONSE, id: envelope.id, result: "some-address" });
    await expect(callPromise).resolves.toBe("some-address");
  });

  it("never puts an origin into the request", () => {
    void send("connect", { permissions: ["ACCESS_ADDRESS"] });
    expect(Object.keys(lastRequestEnvelope()).sort()).toEqual(["id", "method", "params", "type"]);
  });

  it("posts every message to the page's own origin, never a wildcard", () => {
    void send("getActiveAddress");
    transport.requestSiteMode();
    transport.reportOtherWallet({ walletName: "Wander", used: false });
    expect(postMessageSpy).toHaveBeenCalledTimes(3);
    for (const call of postMessageSpy.mock.calls) expect(call[1]).toBe(location.origin);
  });

  it("rejects with the error a page can't post, as on an opaque origin", async () => {
    const syntaxError = new DOMException("Invalid target origin 'null'", "SyntaxError");
    postMessageSpy.mockImplementationOnce(() => {
      throw syntaxError;
    });
    await expect(send("sign")).rejects.toBe(syntaxError);
  });

  it("still sends a request on a plain-http page, where crypto.randomUUID is missing", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto), subtle: crypto.subtle });
    const callPromise = send("connect", { permissions: ["ACCESS_ADDRESS"] });
    const envelope = lastRequestEnvelope();
    expect(envelope.method).toBe("connect");

    post({ type: RESPONSE, id: envelope.id, error: { message: "Gleam only signs for secure (https) sites." } });
    await expect(callPromise).rejects.toThrow("Gleam only signs for secure (https) sites.");
  });

  it("ignores a RESPONSE whose event.source is not window", async () => {
    const callPromise = send("getActiveAddress");
    const envelope = lastRequestEnvelope();

    window.dispatchEvent(
      new MessageEvent("message", { data: { type: RESPONSE, id: envelope.id, result: "forged" }, source: null }),
    );

    let settled = false;
    void callPromise.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    post({ type: RESPONSE, id: envelope.id, result: "real" });
    await expect(callPromise).resolves.toBe("real");
  });

  it("drops a duplicate or late RESPONSE for an id already answered", async () => {
    const callPromise = send("getActiveAddress");
    const envelope = lastRequestEnvelope();

    post({ type: RESPONSE, id: envelope.id, result: "first" });
    await expect(callPromise).resolves.toBe("first");
    expect(() => post({ type: RESPONSE, id: envelope.id, result: "second" })).not.toThrow();
  });

  it("rejects with the error message from an error RESPONSE envelope", async () => {
    const callPromise = send("getActiveAddress");
    post({ type: RESPONSE, id: lastRequestEnvelope().id, error: { message: "not connected" } });
    await expect(callPromise).rejects.toThrow("not connected");
  });

  it("forgets an aborted call without posting anything for it", async () => {
    const controller = new AbortController();
    const callPromise = send("sign", {}, controller.signal);
    const envelope = lastRequestEnvelope();
    postMessageSpy.mockClear();

    controller.abort();
    post({ type: RESPONSE, id: envelope.id, result: "late" });

    let settled = false;
    void callPromise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("hands EVENT envelopes from this window to every subscriber until it unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = transport.onEvent(listener);

    window.dispatchEvent(
      new MessageEvent("message", { data: { type: EVENT, event: "walletSwitch", data: { address: "forged" } }, source: null }),
    );
    post({ type: EVENT, event: "walletSwitch", data: { address: "addr-2" } });
    expect(listener.mock.calls).toEqual([["walletSwitch", { address: "addr-2" }]]);

    unsubscribe();
    post({ type: EVENT, event: "disconnect", data: {} });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hands SITE_MODE from this window to subscribers, ignoring another frame's and a non-boolean", () => {
    const listener = vi.fn();
    const unsubscribe = transport.onSiteMode(listener);

    window.dispatchEvent(new MessageEvent("message", { data: { type: SITE_MODE, useGleam: true }, source: null }));
    post({ type: SITE_MODE, useGleam: "yes" });
    post({ type: SITE_MODE, useGleam: false });
    expect(listener.mock.calls).toEqual([[false]]);

    unsubscribe();
    post({ type: SITE_MODE, useGleam: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("asks for the site mode and reports another wallet as page envelopes", () => {
    transport.requestSiteMode();
    transport.reportOtherWallet({ walletName: "Wander", used: false });
    transport.reportOtherWallet({ walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS"] });

    expect(postMessageSpy.mock.calls.map(([message]: [unknown]) => message)).toEqual([
      { type: SITE_MODE_REQUEST },
      { type: OTHER_WALLET, walletName: "Wander", used: false },
      { type: OTHER_WALLET, walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS"] },
    ]);
  });

  it("stops listening once its signal aborts", async () => {
    const listener = vi.fn();
    transport.onEvent(listener);
    const callPromise = send("getActiveAddress");
    const envelope = lastRequestEnvelope();

    transportListener.abort();
    post({ type: EVENT, event: "walletSwitch", data: {} });
    post({ type: RESPONSE, id: envelope.id, result: "late" });

    let settled = false;
    void callPromise.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("carries a GleamProvider call end to end, binary values tagged both ways", async () => {
    const provider = new GleamProvider(transport, "1.29.0", transportListener.signal);
    const callPromise = provider.signDataItem({ data: new Uint8Array([7]) });
    const envelope = lastRequestEnvelope();
    expect(envelope).toMatchObject({ method: "signDataItem", params: { dataItem: { data: { __gleamType: "Uint8Array", data: [7] } } } });

    post({ type: RESPONSE, id: envelope.id, result: { __gleamType: "ArrayBuffer", data: [1, 0, 9] } });
    const raw = await callPromise;
    expect(Array.from(new Uint8Array(raw as ArrayBuffer))).toEqual([1, 0, 9]);
  });
});
