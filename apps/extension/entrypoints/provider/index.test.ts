import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { APPROVAL_TIMEOUT_MS, REQUEST, RESPONSE } from "@gleam/messaging/src/page-protocol.ts";
import { GleamProvider, install } from "./index";

/**
 * Unit-tests the injected provider script's pure bridge logic directly
 * against jsdom's real `window` (no extension context needed for any of
 * this — `crypto.randomUUID`/`crypto.subtle` and `window.
 * postMessage`/`addEventListener` are all ambient browser APIs).
 * Exercises every item in ARCHITECTURE.md §4.3's numbered list this file
 * is responsible for.
 *
 * `postResponse` dispatches a synthetic `MessageEvent` with `source`
 * explicitly set, rather than calling the real `window.postMessage` to
 * simulate an incoming response: jsdom's own `postMessage` implementation
 * always delivers `event.source === null` (a documented jsdom limitation,
 * not a browser-accurate one — real browsers set `source` to the posting
 * window), which would make every "legitimate response" test in this
 * file indistinguishable from the "forged" case point 1 exists to guard
 * against. Dispatching a synthetic event with `source: window` set
 * exercises the exact same `handleResponse` code path a real browser's
 * `postMessage` would, without depending on jsdom's non-conformant
 * `source` behavior; the one deliberate "forged" test below dispatches
 * with `source: null` instead, for the same reason.
 */
function postResponse(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data, source: window }));
}

describe("provider.ts: GleamProvider bridge (ARCHITECTURE.md §4.3)", () => {
  let provider: GleamProvider;
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    provider = new GleamProvider();
    postMessageSpy = vi.spyOn(window, "postMessage");
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
    vi.useRealTimers();
  });

  function lastRequestEnvelope() {
    const call = postMessageSpy.mock.calls.find(([message]) => (message as { type?: string })?.type === REQUEST);
    if (!call) throw new Error("No REQUEST envelope was posted.");
    return call[0] as { id: string; method: string; params: unknown };
  }

  it("posts a REQUEST envelope with a fresh crypto.randomUUID id per call (point 2)", async () => {
    const callPromise = provider.getActiveAddress();
    const envelope = lastRequestEnvelope();
    expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.method).toBe("getActiveAddress");

    postResponse({ type: RESPONSE, id: envelope.id, result: "some-address" });
    await expect(callPromise).resolves.toBe("some-address");
  });

  it("transferAoTokens posts a REQUEST envelope carrying token/recipient/amount, resolving with the relayed result", async () => {
    const callPromise = provider.transferAoTokens({
      token: "ao-process-id",
      recipient: "recipient-addr",
      amount: "1000",
    });
    const envelope = lastRequestEnvelope();
    expect(envelope.method).toBe("transferAoTokens");
    expect(envelope.params).toEqual({ token: "ao-process-id", recipient: "recipient-addr", amount: "1000" });

    postResponse({ type: RESPONSE, id: envelope.id, result: { id: "ao-message-id-123" } });
    await expect(callPromise).resolves.toEqual({ id: "ao-message-id-123" });
  });

  it("sign and dispatch send an arweave-js transaction as its toJSON() form", () => {
    const transaction = {
      data: new Uint8Array([1, 2, 3]),
      chunks: { chunks: [], proofs: [] },
      toJSON: () => ({ data: "AQID", tags: [] }),
    };
    void provider.sign(transaction);
    expect(lastRequestEnvelope().params).toEqual({ transaction: { data: "AQID", tags: [] }, options: undefined });

    postMessageSpy.mockClear();
    void provider.dispatch(transaction);
    expect(lastRequestEnvelope()).toMatchObject({ method: "dispatch", params: { transaction: { data: "AQID", tags: [] } } });
  });

  it("sign hands back the caller's own tag objects when the signed tags match", async () => {
    class Tag {
      constructor(
        public name: string,
        public value: string,
      ) {}
      get(): string {
        return this.value;
      }
    }
    const callerTags = [new Tag("QXBw", "R2xlYW0")];
    const callPromise = provider.sign({ tags: callerTags, toJSON: () => ({ tags: [{ name: "QXBw", value: "R2xlYW0" }] }) });
    const envelope = lastRequestEnvelope();

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      result: { id: "tx-id", owner: "owner", signature: "sig", reward: "5000", tags: [{ name: "QXBw", value: "R2xlYW0" }] },
    });

    const signed = (await callPromise) as { id: string; tags: unknown[] };
    expect(signed.id).toBe("tx-id");
    expect(signed.tags).toBe(callerTags);
  });

  it("signDataItem sends the item under dataItem and resolves to the signed ArrayBuffer", async () => {
    const callPromise = provider.signDataItem({ data: new Uint8Array([7]), tags: [{ name: "Action", value: "Eval" }] });
    const envelope = lastRequestEnvelope();
    expect(envelope).toMatchObject({
      method: "signDataItem",
      params: { dataItem: { data: { __gleamType: "Uint8Array", data: [7] }, tags: [{ name: "Action", value: "Eval" }] } },
    });

    postResponse({ type: RESPONSE, id: envelope.id, result: { __gleamType: "ArrayBuffer", data: [1, 0, 9] } });
    const raw = await callPromise;
    expect(Object.prototype.toString.call(raw)).toBe("[object ArrayBuffer]");
    expect(Array.from(new Uint8Array(raw as ArrayBuffer))).toEqual([1, 0, 9]);
  });

  it("batchSignDataItem sends the items under dataItems and resolves to an ArrayBuffer per item", async () => {
    const callPromise = provider.batchSignDataItem([{ data: "a" }, { data: "b" }]);
    const envelope = lastRequestEnvelope();
    expect(envelope).toMatchObject({ method: "batchSignDataItem", params: { dataItems: [{ data: "a" }, { data: "b" }] } });

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      result: [
        { __gleamType: "ArrayBuffer", data: [1] },
        { __gleamType: "ArrayBuffer", data: [2] },
      ],
    });
    const raws = (await callPromise) as ArrayBuffer[];
    expect(raws.map((raw) => Array.from(new Uint8Array(raw)))).toEqual([[1], [2]]);
  });

  it("verifyMessage forwards Wander's four arguments with binary tagged", () => {
    void provider.verifyMessage(new Uint8Array([1]), "c2ln", "pubkey", { hashAlgorithm: "SHA-512" });
    expect(lastRequestEnvelope().params).toEqual({
      data: { __gleamType: "Uint8Array", data: [1] },
      signature: "c2ln",
      publicKey: "pubkey",
      options: { hashAlgorithm: "SHA-512" },
    });
  });

  it("ignores a RESPONSE whose event.source is not window (point 1)", async () => {
    const callPromise = provider.getActiveAddress();
    const envelope = lastRequestEnvelope();

    // `source: null` simulates a forged message that didn't actually
    // originate from this window's own postMessage.
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: RESPONSE, id: envelope.id, result: "forged" }, source: null }),
    );

    // Still pending — the forged message must not have resolved it.
    let settled = false;
    void callPromise.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    postResponse({ type: RESPONSE, id: envelope.id, result: "real" });
    await expect(callPromise).resolves.toBe("real");
  });

  it("a duplicate/late RESPONSE for an already-settled id is dropped (point 3)", async () => {
    const callPromise = provider.getActiveAddress();
    const envelope = lastRequestEnvelope();

    postResponse({ type: RESPONSE, id: envelope.id, result: "first" });
    await expect(callPromise).resolves.toBe("first");

    // A second response for the same id must not throw or double-resolve
    // anything observable — nothing to await here, just that it's silently ignored.
    expect(() => postResponse({ type: RESPONSE, id: envelope.id, result: "second" })).not.toThrow();
  });

  it("rejects with a named timeout error if no response ever arrives (point 4)", async () => {
    vi.useFakeTimers();
    const callPromise = provider.getActiveAddress();
    const assertion = expect(callPromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("an approval-gated call outlives the background's approval timeout, then still times out", async () => {
    vi.useFakeTimers();
    const callPromise = provider.sign({ some: "tx" });
    const envelope = lastRequestEnvelope();
    let settled = false;
    callPromise.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);
    expect(settled).toBe(false);

    postResponse({ type: RESPONSE, id: envelope.id, result: { id: "signed" } });
    await expect(callPromise).resolves.toMatchObject({ id: "signed" });

    const connectPromise = provider.connect(["ACCESS_ADDRESS"]);
    const assertion = expect(connectPromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS + 60_000);
    await assertion;
  });

  it("rejects immediately on abort without posting any further request (point 5)", async () => {
    const controller = new AbortController();
    const callPromise = provider.sign({ some: "tx" }, { signal: controller.signal } as never);
    const signEnvelope = lastRequestEnvelope();
    postMessageSpy.mockClear();

    const assertion = expect(callPromise).rejects.toThrow(/aborted/i);
    controller.abort();
    await assertion;

    // A posted `disconnect` would be run by the background and revoke the grant.
    expect(postMessageSpy).not.toHaveBeenCalled();

    // A late response for the aborted call is dropped.
    expect(() => postResponse({ type: RESPONSE, id: signEnvelope.id, result: "late" })).not.toThrow();
  });

  it("rejects immediately for an already-aborted signal, without posting a request", async () => {
    const controller = new AbortController();
    controller.abort();

    const callPromise = (
      provider as unknown as { call: (m: string, p: unknown, s?: AbortSignal) => Promise<unknown> }
    ).call("getActiveAddress", {}, controller.signal);

    postMessageSpy.mockClear();
    await expect(callPromise).rejects.toThrow(/aborted/i);
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it("decodes tagged binary results back into real typed arrays", async () => {
    const callPromise = provider.sign({});
    const envelope = lastRequestEnvelope();

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      result: { raw: { __gleamType: "Uint8Array", data: [1, 2, 3] } },
    });

    const result = (await callPromise) as { raw: Uint8Array };
    expect(Array.from(result.raw)).toEqual([1, 2, 3]);
  });

  it("rejects with the error message from an error RESPONSE envelope", async () => {
    const callPromise = provider.getActiveAddress();
    const envelope = lastRequestEnvelope();

    postResponse({ type: RESPONSE, id: envelope.id, error: { message: "not connected" } });
    await expect(callPromise).rejects.toThrow("not connected");
  });
});

describe("provider.ts: install() never clobbers an existing provider (point 7)", () => {
  afterEach(() => {
    // @ts-expect-error -- test cleanup of a global this suite installs
    delete window.arweaveWallet;
  });

  it("installs window.arweaveWallet with walletName 'Gleam' when none exists", () => {
    install();
    expect((window as unknown as { arweaveWallet: { walletName: string } }).arweaveWallet.walletName).toBe(
      "Gleam",
    );
  });

  it("does not overwrite an already-installed provider", () => {
    const existing = { walletName: "SomeoneElse" };
    Object.defineProperty(window, "arweaveWallet", { value: existing, configurable: true, writable: true });

    install();

    expect((window as unknown as { arweaveWallet: unknown }).arweaveWallet).toBe(existing);
  });
});
