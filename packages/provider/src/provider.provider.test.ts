import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_MAX_MS, PROVIDER_SURFACE_METHODS } from "@gleam/messaging/src/page-protocol.ts";
import { createFakeTransport, type FakeTransport } from "../testing/fake-transport";
import { GleamProvider } from "./provider";

describe("GleamProvider over a ProviderTransport", () => {
  let fake: FakeTransport;
  let provider: GleamProvider;
  let providerListener: AbortController;

  beforeEach(() => {
    fake = createFakeTransport();
    providerListener = new AbortController();
    provider = new GleamProvider(fake.transport, "1.29.0", providerListener.signal);
  });

  afterEach(() => {
    providerListener.abort();
    vi.useRealTimers();
  });

  it("names itself Gleam with the version it was given", () => {
    expect(provider.walletName).toBe("Gleam");
    expect(provider.walletVersion).toBe("1.29.0");
  });

  it("keeps the transport out of reach of page scripts", () => {
    expect(Object.keys(provider)).toEqual(["walletName", "walletVersion"]);
    for (const value of Object.values(provider)) expect(value).not.toBe(fake.transport);
  });

  it("sends each call through the transport and resolves with its result", async () => {
    const callPromise = provider.getActiveAddress();
    expect(fake.lastRequest()).toMatchObject({ method: "getActiveAddress", params: {} });
    fake.lastRequest().resolve("some-address");
    await expect(callPromise).resolves.toBe("some-address");
  });

  it("rejects with the transport's error", async () => {
    const callPromise = provider.getActiveAddress();
    fake.lastRequest().reject(new Error("not connected"));
    await expect(callPromise).rejects.toThrow("not connected");
  });

  it("rejects when the result can't be decoded, rather than hanging", async () => {
    const decodeError = new Error("unreadable result");
    const callPromise = provider.getBalances();
    fake.lastRequest().resolve({
      get balance() {
        throw decodeError;
      },
    });
    await expect(callPromise).rejects.toBe(decodeError);
  });

  it("rejects and forgets a call the transport couldn't send", async () => {
    vi.useFakeTimers();
    const syntaxError = new DOMException("Invalid target origin 'null'", "SyntaxError");
    vi.spyOn(fake.transport, "request").mockImplementationOnce(() => {
      throw syntaxError;
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await expect(provider.sign({}, { signal: controller.signal })).rejects.toBe(syntaxError);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("transferAoTokens sends token/recipient/amount, resolving with the result", async () => {
    const callPromise = provider.transferAoTokens({ token: "ao-process-id", recipient: "recipient-addr", amount: "1000" });
    expect(fake.lastRequest()).toMatchObject({
      method: "transferAoTokens",
      params: { token: "ao-process-id", recipient: "recipient-addr", amount: "1000" },
    });
    fake.lastRequest().resolve({ id: "ao-message-id-123" });
    await expect(callPromise).resolves.toEqual({ id: "ao-message-id-123" });
  });

  it("addToken sends only the id, drops Wander's type and gateway, and resolves to undefined", async () => {
    const callPromise = provider.addToken("p".repeat(43), "asset", { host: "arweave.net" });
    expect(fake.lastRequest().method).toBe("addToken");
    expect(fake.lastRequest().params).toEqual({ id: "p".repeat(43) });
    fake.lastRequest().resolve(null);
    await expect(callPromise).resolves.toBeUndefined();
  });

  it("isTokenAdded sends the id and resolves to the result", async () => {
    const callPromise = provider.isTokenAdded("p".repeat(43));
    expect(fake.lastRequest()).toMatchObject({ method: "isTokenAdded", params: { id: "p".repeat(43) } });
    fake.lastRequest().resolve(true);
    await expect(callPromise).resolves.toBe(true);
  });

  it("has a method for every provider surface method", () => {
    const missing = PROVIDER_SURFACE_METHODS.filter(
      (method) => typeof (provider as unknown as Record<string, unknown>)[method] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("tokenBalance sends the id and resolves to the balance string", async () => {
    const callPromise = provider.tokenBalance("p".repeat(43));
    expect(fake.lastRequest()).toMatchObject({ method: "tokenBalance", params: { id: "p".repeat(43) } });
    fake.lastRequest().resolve("1000000");
    await expect(callPromise).resolves.toBe("1000000");
  });

  it("userTokens forwards Wander's options and resolves to the list", async () => {
    const tokens = [{ processId: "p".repeat(43), Ticker: "TKN", Denomination: 6, balance: "5" }];
    const callPromise = provider.userTokens({ fetchBalance: true });
    expect(fake.lastRequest()).toMatchObject({ method: "userTokens", params: { options: { fetchBalance: true } } });
    fake.lastRequest().resolve(tokens);
    await expect(callPromise).resolves.toEqual(tokens);
  });

  it("addToken waits as long as an approval can take", async () => {
    vi.useFakeTimers();
    const callPromise = provider.addToken("p".repeat(43));
    let settled = false;
    callPromise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(APPROVAL_MAX_MS);
    expect(settled).toBe(false);
  });

  it("sign and dispatch send an arweave-js transaction as its toJSON() form", () => {
    const transaction = {
      data: new Uint8Array([1, 2, 3]),
      chunks: { chunks: [], proofs: [] },
      toJSON: () => ({ data: "AQID", tags: [] }),
    };
    void provider.sign(transaction);
    expect(fake.lastRequest().params).toEqual({ transaction: { data: "AQID", tags: [] }, options: undefined });

    void provider.dispatch(transaction);
    expect(fake.lastRequest()).toMatchObject({ method: "dispatch", params: { transaction: { data: "AQID", tags: [] } } });
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
    fake.lastRequest().resolve({
      id: "tx-id",
      owner: "owner",
      signature: "sig",
      reward: "5000",
      tags: [{ name: "QXBw", value: "R2xlYW0" }],
    });

    const signed = (await callPromise) as { id: string; tags: unknown[] };
    expect(signed.id).toBe("tx-id");
    expect(signed.tags).toBe(callerTags);
  });

  it("signDataItem tags binary params and resolves to the signed ArrayBuffer", async () => {
    const callPromise = provider.signDataItem({ data: new Uint8Array([7]), tags: [{ name: "Action", value: "Eval" }] });
    expect(fake.lastRequest()).toMatchObject({
      method: "signDataItem",
      params: { dataItem: { data: { __gleamType: "Uint8Array", data: [7] }, tags: [{ name: "Action", value: "Eval" }] } },
    });

    fake.lastRequest().resolve({ __gleamType: "ArrayBuffer", data: [1, 0, 9] });
    const raw = await callPromise;
    expect(Object.prototype.toString.call(raw)).toBe("[object ArrayBuffer]");
    expect(Array.from(new Uint8Array(raw as ArrayBuffer))).toEqual([1, 0, 9]);
  });

  it("batchSignDataItem sends the items under dataItems and resolves to an ArrayBuffer per item", async () => {
    const callPromise = provider.batchSignDataItem([{ data: "a" }, { data: "b" }]);
    expect(fake.lastRequest()).toMatchObject({
      method: "batchSignDataItem",
      params: { dataItems: [{ data: "a" }, { data: "b" }] },
    });

    fake.lastRequest().resolve([
      { __gleamType: "ArrayBuffer", data: [1] },
      { __gleamType: "ArrayBuffer", data: [2] },
    ]);
    const raws = (await callPromise) as ArrayBuffer[];
    expect(raws.map((raw) => Array.from(new Uint8Array(raw)))).toEqual([[1], [2]]);
  });

  it("verifyMessage forwards Wander's four arguments with binary tagged", () => {
    void provider.verifyMessage(new Uint8Array([1]), "c2ln", "pubkey", { hashAlgorithm: "SHA-512" });
    expect(fake.lastRequest().params).toEqual({
      data: { __gleamType: "Uint8Array", data: [1] },
      signature: "c2ln",
      publicKey: "pubkey",
      options: { hashAlgorithm: "SHA-512" },
    });
  });

  it("drops a result that arrives after the call settled", async () => {
    vi.useFakeTimers();
    const callPromise = provider.getActiveAddress();
    const assertion = expect(callPromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fake.lastRequest().signal.aborted).toBe(true);
    expect(() => fake.lastRequest().resolve("late")).not.toThrow();
  });

  it("rejects with a named timeout error if no result ever arrives", async () => {
    vi.useFakeTimers();
    const callPromise = provider.getActiveAddress();
    const assertion = expect(callPromise).rejects.toThrow('"getActiveAddress" timed out after 60000ms.');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("an approval-gated call outlives the longest approval, then still times out", async () => {
    vi.useFakeTimers();
    const callPromise = provider.sign({ some: "tx" });
    const signRequest = fake.lastRequest();
    let settled = false;
    callPromise.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(APPROVAL_MAX_MS);
    expect(settled).toBe(false);

    signRequest.resolve({ id: "signed" });
    await expect(callPromise).resolves.toMatchObject({ id: "signed" });

    const connectPromise = provider.connect(["ACCESS_ADDRESS"]);
    const assertion = expect(connectPromise).rejects.toThrow(`"connect" timed out after ${APPROVAL_MAX_MS + 60_000}ms.`);
    await vi.advanceTimersByTimeAsync(APPROVAL_MAX_MS + 60_000);
    await assertion;
  });

  it("rejects on abort, tells the transport to forget the call, and sends nothing more", async () => {
    const controller = new AbortController();
    const callPromise = provider.sign({ some: "tx" }, { signal: controller.signal } as never);
    const signRequest = fake.lastRequest();

    const assertion = expect(callPromise).rejects.toThrow('"sign" was aborted.');
    controller.abort();
    await assertion;

    // A sent `disconnect` would be run by the background and revoke the grant.
    expect(fake.requests).toHaveLength(1);
    expect(signRequest.signal.aborted).toBe(true);
    expect(() => signRequest.resolve("late")).not.toThrow();
  });

  it("rejects at once for an already-aborted signal, without sending a request", async () => {
    const controller = new AbortController();
    controller.abort();

    const callPromise = (
      provider as unknown as { call: (m: string, p: unknown, s?: AbortSignal) => Promise<unknown> }
    ).call("getActiveAddress", {}, controller.signal);

    await expect(callPromise).rejects.toThrow('"getActiveAddress" was aborted before it was sent.');
    expect(fake.requests).toHaveLength(0);
  });

  it("decodes tagged binary results back into real typed arrays", async () => {
    const callPromise = provider.sign({});
    fake.lastRequest().resolve({ raw: { __gleamType: "Uint8Array", data: [1, 2, 3] } });
    const result = (await callPromise) as { raw: Uint8Array };
    expect(Array.from(result.raw)).toEqual([1, 2, 3]);
  });

  it("dispatches each pushed event on the window until its signal aborts", () => {
    const onSwitch = vi.fn();
    window.addEventListener("walletSwitch", onSwitch);
    try {
      fake.push("walletSwitch", { address: "addr-2" });
      expect(onSwitch).toHaveBeenCalledTimes(1);
      expect((onSwitch.mock.calls[0]![0] as CustomEvent).detail).toEqual({ address: "addr-2" });

      providerListener.abort();
      fake.push("walletSwitch", { address: "addr-3" });
      expect(onSwitch).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("walletSwitch", onSwitch);
    }
  });
});
