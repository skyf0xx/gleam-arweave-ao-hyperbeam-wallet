import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  APPROVAL_MAX_MS,
  OTHER_WALLET,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
} from "@gleam/messaging/src/page-protocol.ts";
import { GleamProvider, install, PROVIDER_SURFACE_METHODS } from "./index";
import { version as PACKAGE_VERSION } from "../../package.json";

/**
 * Unit-tests the injected provider script's pure bridge logic directly
 * against jsdom's real `window` (no extension context needed for any of
 * this — `crypto.getRandomValues`/`crypto.subtle` and `window.
 * postMessage`/`addEventListener` are all ambient browser APIs).
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

describe("provider.ts: GleamProvider bridge", () => {
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
    const call = postMessageSpy.mock.calls.find(
      ([message]: [unknown]) => (message as { type?: string })?.type === REQUEST,
    );
    if (!call) throw new Error("No REQUEST envelope was posted.");
    return call[0] as { id: string; method: string; params: unknown };
  }

  it("posts a REQUEST envelope with a fresh random id per call (point 2)", async () => {
    const callPromise = provider.getActiveAddress();
    const envelope = lastRequestEnvelope();
    expect(envelope.id).toMatch(/^[0-9a-f]{32}$/);
    expect(envelope.method).toBe("getActiveAddress");

    void provider.getActiveAddress();
    const ids = (postMessageSpy.mock.calls as [{ type?: string; id?: string }][])
      .filter(([message]) => message.type === REQUEST)
      .map(([message]) => message.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);

    postResponse({ type: RESPONSE, id: envelope.id, result: "some-address" });
    await expect(callPromise).resolves.toBe("some-address");
  });

  it("posts requests to the page's own origin, never a wildcard", () => {
    void provider.getActiveAddress();
    const call = postMessageSpy.mock.calls.find(([message]: [unknown]) => (message as { type?: string })?.type === REQUEST);
    expect(call?.[1]).toBe(location.origin);
  });

  it("still sends a request on a plain-http page, where crypto.randomUUID is missing", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto), subtle: crypto.subtle });
    try {
      const callPromise = provider.connect(["ACCESS_ADDRESS"]);
      const envelope = lastRequestEnvelope();
      expect(envelope.method).toBe("connect");

      postResponse({ type: RESPONSE, id: envelope.id, error: { message: "Gleam only signs for secure (https) sites." } });
      await expect(callPromise).rejects.toThrow("Gleam only signs for secure (https) sites.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("transferAoTokens posts a REQUEST envelope carrying token/recipient/amount, resolving with the relayed result", async () => {
    const callPromise = provider.transferAoTokens({
      token: "ao-process-id",
      recipient: "recipient-addr",
      amount: "1000",
    });
    const envelope = lastRequestEnvelope();
    expect(envelope.method).toBe("transferAoTokens");
    expect(envelope.params).toEqual({
      token: "ao-process-id",
      recipient: "recipient-addr",
      amount: "1000",
    });

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      result: { id: "ao-message-id-123" },
    });
    await expect(callPromise).resolves.toEqual({ id: "ao-message-id-123" });
  });

  it("addToken sends only the id, drops Wander's type and gateway, and resolves to undefined", async () => {
    const callPromise = provider.addToken("p".repeat(43), "asset", { host: "arweave.net" });
    const envelope = lastRequestEnvelope();
    expect(envelope.method).toBe("addToken");
    expect(envelope.params).toEqual({ id: "p".repeat(43) });

    postResponse({ type: RESPONSE, id: envelope.id, result: null });
    await expect(callPromise).resolves.toBeUndefined();
  });

  it("isTokenAdded sends the id and resolves to the relayed boolean", async () => {
    const callPromise = provider.isTokenAdded("p".repeat(43));
    const envelope = lastRequestEnvelope();
    expect(envelope.method).toBe("isTokenAdded");
    expect(envelope.params).toEqual({ id: "p".repeat(43) });

    postResponse({ type: RESPONSE, id: envelope.id, result: true });
    await expect(callPromise).resolves.toBe(true);
  });

  it("has a method for every provider surface method", () => {
    const missing = PROVIDER_SURFACE_METHODS.filter(
      (method) => typeof (provider as unknown as Record<string, unknown>)[method] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("tokenBalance sends the id and resolves to the relayed balance string", async () => {
    const callPromise = provider.tokenBalance("p".repeat(43));
    const envelope = lastRequestEnvelope();
    expect(envelope.method).toBe("tokenBalance");
    expect(envelope.params).toEqual({ id: "p".repeat(43) });

    postResponse({ type: RESPONSE, id: envelope.id, result: "1000000" });
    await expect(callPromise).resolves.toBe("1000000");
  });

  it("userTokens forwards Wander's options and resolves to the relayed list", async () => {
    const tokens = [{ processId: "p".repeat(43), Ticker: "TKN", Denomination: 6, balance: "5" }];
    const callPromise = provider.userTokens({ fetchBalance: true });
    const envelope = lastRequestEnvelope();
    expect(envelope.method).toBe("userTokens");
    expect(envelope.params).toEqual({ options: { fetchBalance: true } });

    postResponse({ type: RESPONSE, id: envelope.id, result: tokens });
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
    expect(lastRequestEnvelope().params).toEqual({
      transaction: { data: "AQID", tags: [] },
      options: undefined,
    });

    postMessageSpy.mockClear();
    void provider.dispatch(transaction);
    expect(lastRequestEnvelope()).toMatchObject({
      method: "dispatch",
      params: { transaction: { data: "AQID", tags: [] } },
    });
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
    const callPromise = provider.sign({
      tags: callerTags,
      toJSON: () => ({ tags: [{ name: "QXBw", value: "R2xlYW0" }] }),
    });
    const envelope = lastRequestEnvelope();

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      result: {
        id: "tx-id",
        owner: "owner",
        signature: "sig",
        reward: "5000",
        tags: [{ name: "QXBw", value: "R2xlYW0" }],
      },
    });

    const signed = (await callPromise) as { id: string; tags: unknown[] };
    expect(signed.id).toBe("tx-id");
    expect(signed.tags).toBe(callerTags);
  });

  it("signDataItem sends the item under dataItem and resolves to the signed ArrayBuffer", async () => {
    const callPromise = provider.signDataItem({
      data: new Uint8Array([7]),
      tags: [{ name: "Action", value: "Eval" }],
    });
    const envelope = lastRequestEnvelope();
    expect(envelope).toMatchObject({
      method: "signDataItem",
      params: {
        dataItem: {
          data: { __gleamType: "Uint8Array", data: [7] },
          tags: [{ name: "Action", value: "Eval" }],
        },
      },
    });

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      result: { __gleamType: "ArrayBuffer", data: [1, 0, 9] },
    });
    const raw = await callPromise;
    expect(Object.prototype.toString.call(raw)).toBe("[object ArrayBuffer]");
    expect(Array.from(new Uint8Array(raw as ArrayBuffer))).toEqual([1, 0, 9]);
  });

  it("batchSignDataItem sends the items under dataItems and resolves to an ArrayBuffer per item", async () => {
    const callPromise = provider.batchSignDataItem([
      { data: "a" },
      { data: "b" },
    ]);
    const envelope = lastRequestEnvelope();
    expect(envelope).toMatchObject({
      method: "batchSignDataItem",
      params: { dataItems: [{ data: "a" }, { data: "b" }] },
    });

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      result: [
        { __gleamType: "ArrayBuffer", data: [1] },
        { __gleamType: "ArrayBuffer", data: [2] },
      ],
    });
    const raws = (await callPromise) as ArrayBuffer[];
    expect(raws.map((raw) => Array.from(new Uint8Array(raw)))).toEqual([
      [1],
      [2],
    ]);
  });

  it("verifyMessage forwards Wander's four arguments with binary tagged", () => {
    void provider.verifyMessage(new Uint8Array([1]), "c2ln", "pubkey", {
      hashAlgorithm: "SHA-512",
    });
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
      new MessageEvent("message", {
        data: { type: RESPONSE, id: envelope.id, result: "forged" },
        source: null,
      }),
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
    expect(() =>
      postResponse({ type: RESPONSE, id: envelope.id, result: "second" }),
    ).not.toThrow();
  });

  it("rejects with a named timeout error if no response ever arrives (point 4)", async () => {
    vi.useFakeTimers();
    const callPromise = provider.getActiveAddress();
    const assertion = expect(callPromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("an approval-gated call outlives the longest approval, then still times out", async () => {
    vi.useFakeTimers();
    const callPromise = provider.sign({ some: "tx" });
    const envelope = lastRequestEnvelope();
    let settled = false;
    callPromise.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(APPROVAL_MAX_MS);
    expect(settled).toBe(false);

    postResponse({ type: RESPONSE, id: envelope.id, result: { id: "signed" } });
    await expect(callPromise).resolves.toMatchObject({ id: "signed" });

    const connectPromise = provider.connect(["ACCESS_ADDRESS"]);
    const assertion = expect(connectPromise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(APPROVAL_MAX_MS + 60_000);
    await assertion;
  });

  it("rejects immediately on abort without posting any further request (point 5)", async () => {
    const controller = new AbortController();
    const callPromise = provider.sign({ some: "tx" }, {
      signal: controller.signal,
    } as never);
    const signEnvelope = lastRequestEnvelope();
    postMessageSpy.mockClear();

    const assertion = expect(callPromise).rejects.toThrow(/aborted/i);
    controller.abort();
    await assertion;

    // A posted `disconnect` would be run by the background and revoke the grant.
    expect(postMessageSpy).not.toHaveBeenCalled();

    // A late response for the aborted call is dropped.
    expect(() =>
      postResponse({ type: RESPONSE, id: signEnvelope.id, result: "late" }),
    ).not.toThrow();
  });

  it("rejects immediately for an already-aborted signal, without posting a request", async () => {
    const controller = new AbortController();
    controller.abort();

    const callPromise = (
      provider as unknown as {
        call: (m: string, p: unknown, s?: AbortSignal) => Promise<unknown>;
      }
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

    postResponse({
      type: RESPONSE,
      id: envelope.id,
      error: { message: "not connected" },
    });
    await expect(callPromise).rejects.toThrow("not connected");
  });
});

describe("provider.ts: install() routes window.arweaveWallet (point 7)", () => {
  let teardown: (() => void) | undefined;
  const listeners: Array<[string, () => void]> = [];
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(window, "postMessage");
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    for (const [event, listener] of listeners.splice(0)) window.removeEventListener(event, listener);
    postMessageSpy.mockRestore();
    vi.useRealTimers();
    // @ts-expect-error -- test cleanup of a global this suite installs
    delete window.arweaveWallet;
    // @ts-expect-error -- test cleanup of a global this suite installs
    delete window.permawebConnect;
    // @ts-expect-error -- test cleanup of a global this suite installs
    delete window.gleam;
  });

  type Wallet = { walletName?: string; connect?: (...args: unknown[]) => unknown; [key: string]: unknown };

  function current(): Wallet | undefined {
    return (window as unknown as { arweaveWallet?: Wallet }).arweaveWallet;
  }

  function installOther(value: unknown, writable = true): void {
    Object.defineProperty(window, "arweaveWallet", {
      value,
      configurable: true,
      writable,
    });
  }

  function wander() {
    return { walletName: "Wander", connect: vi.fn().mockResolvedValue("wander-connected"), events: { on: vi.fn() } };
  }

  function sendSiteMode(useGleam: boolean): void {
    window.dispatchEvent(new MessageEvent("message", { data: { type: SITE_MODE, useGleam }, source: window }));
  }

  function otherWalletReports() {
    return postMessageSpy.mock.calls
      .map(([message]: [unknown]) => message as { type?: string })
      .filter((message: { type?: string }) => message?.type === OTHER_WALLET);
  }

  function gleamRequests() {
    return postMessageSpy.mock.calls.filter(([message]: [unknown]) => (message as { type?: string })?.type === REQUEST);
  }

  it("installs window.arweaveWallet with walletName 'Gleam' when none exists", () => {
    teardown = install();
    expect(current()?.walletName).toBe("Gleam");
  });

  it("exposes walletVersion, the extension's own version", () => {
    teardown = install();
    expect(current()?.walletVersion).toBe(PACKAGE_VERSION);
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  // dApps compare walletVersion against Wander's version numbers. ArDrive
  // refuses anything below 1.26.0.
  it("keeps walletVersion at or above the Wander version dApps require", () => {
    const [major, minor] = PACKAGE_VERSION.split(".").map(Number);
    expect(major! > 1 || (major === 1 && minor! >= 26)).toBe(true);
  });

  function listen(event: string) {
    const listener = vi.fn();
    window.addEventListener(event, listener);
    listeners.push([event, listener]);
    return listener;
  }

  it("announces Gleam with arweaveWalletLoaded only once other wallets have had the chance to install", async () => {
    vi.useFakeTimers();
    const onLoaded = listen("arweaveWalletLoaded");
    teardown = install();
    expect(onLoaded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("announces window.gleam with gleamWalletLoaded straight away", () => {
    const onGleam = listen("gleamWalletLoaded");
    teardown = install();
    expect(onGleam).toHaveBeenCalledTimes(1);
  });

  it("waits for DOMContentLoaded before settling on a page that is still loading", async () => {
    vi.useFakeTimers();
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    try {
      const onLoaded = listen("arweaveWalletLoaded");
      teardown = install();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onLoaded).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("DOMContentLoaded"));
      await vi.advanceTimersByTimeAsync(150);
      expect(onLoaded).toHaveBeenCalledTimes(1);
    } finally {
      readyState.mockRestore();
    }
  });

  it("calls Gleam once no other wallet has shown up", async () => {
    vi.useFakeTimers();
    teardown = install();
    void current()!.connect!(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(gleamRequests()).toHaveLength(1);
    void current()!.connect!(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(2);
  });

  it("forwards a call made before a later wallet installs to that wallet", async () => {
    vi.useFakeTimers();
    teardown = install();
    const pending = current()!.connect!(["ACCESS_ADDRESS"]);

    const other = wander();
    (window as unknown as { arweaveWallet: unknown }).arweaveWallet = other;
    sendSiteMode(false);

    await expect(pending).resolves.toBe("wander-connected");
    expect(gleamRequests()).toHaveLength(0);
  });

  it("announces a wallet that installed first straight away", () => {
    installOther(wander());
    const onLoaded = listen("arweaveWalletLoaded");
    teardown = install();
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("doesn't announce again a later wallet that announced itself", async () => {
    vi.useFakeTimers();
    teardown = install();
    const onLoaded = listen("arweaveWalletLoaded");
    installOther(wander());
    window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));
    await vi.advanceTimersByTimeAsync(150);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("forwards to a wallet installed first once the site turns out not to use Gleam", async () => {
    const other = wander();
    installOther(other);
    teardown = install();
    expect(current()?.walletName).toBe("Wander");

    const pending = current()!.connect!(["ACCESS_ADDRESS"]);
    expect(other.connect).not.toHaveBeenCalled();
    sendSiteMode(false);

    await expect(pending).resolves.toBe("wander-connected");
    expect(other.connect).toHaveBeenCalledWith(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(0);
  });

  it("calls the other wallet with itself as this", async () => {
    const other = {
      walletName: "Wander",
      connect(this: unknown) {
        return Promise.resolve(this === other);
      },
    };
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    await expect(current()!.connect!()).resolves.toBe(true);
  });

  it("uses Gleam on a site that holds a grant, even with another wallet installed", async () => {
    const other = wander();
    installOther(other, false);
    teardown = install();
    sendSiteMode(true);

    expect(current()?.walletName).toBe("Gleam");
    void current()!.connect!();
    await vi.waitFor(() => expect(gleamRequests()).toHaveLength(1));
    expect(other.connect).not.toHaveBeenCalled();
  });

  it("falls back to the other wallet when the site mode never arrives", async () => {
    vi.useFakeTimers();
    const other = wander();
    installOther(other);
    teardown = install();

    const pending = current()!.connect!();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(other.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("wander-connected");
  });

  function modeRequests() {
    return postMessageSpy.mock.calls.filter(([message]: [unknown]) => (message as { type?: string })?.type === SITE_MODE_REQUEST);
  }

  it("never asks for the site mode on a page where Gleam is the only wallet", async () => {
    vi.useFakeTimers();
    teardown = install();
    void current()!.connect!();
    await vi.advanceTimersByTimeAsync(150);
    expect(modeRequests()).toHaveLength(0);
  });

  it("announces PermawebOS when it loads after the page settled on Gleam", async () => {
    vi.useFakeTimers();
    teardown = install();
    await vi.advanceTimersByTimeAsync(150);
    const onLoaded = listen("arweaveWalletLoaded");
    permawebOS();
    window.dispatchEvent(new CustomEvent("permawebConnectLoaded"));
    window.dispatchEvent(new CustomEvent("permawebConnectLoaded"));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(modeRequests()).toHaveLength(1);
  });

  it("asks for the site mode once, as soon as another wallet shows up", () => {
    installOther(wander());
    teardown = install();
    void current()!.connect!();
    expect(modeRequests()).toHaveLength(1);
  });

  it("enumerates the other wallet's own properties through the router", () => {
    const other = wander();
    installOther(other);
    teardown = install();
    sendSiteMode(false);

    expect(Object.keys(current()!)).toEqual(Object.keys(other));
    expect(Object.prototype.hasOwnProperty.call(current(), "connect")).toBe(true);
    expect({ ...current() }.walletName).toBe("Wander");
  });

  it("routes a cached method to whichever wallet the site uses at call time", async () => {
    const other = wander();
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    const connect = current()!.connect!;

    await connect();
    expect(other.connect).toHaveBeenCalledTimes(1);

    sendSiteMode(true);
    void connect();
    expect(other.connect).toHaveBeenCalledTimes(1);
    expect(gleamRequests()).toHaveLength(1);
  });

  it("reports the other wallet once on sight and once on first use", async () => {
    installOther(wander());
    teardown = install();
    sendSiteMode(false);
    await current()!.connect!();
    await current()!.connect!();

    expect(otherWalletReports()).toEqual([
      { type: OTHER_WALLET, walletName: "Wander", used: false },
      { type: OTHER_WALLET, walletName: "Wander", used: true },
    ]);
  });

  it("reports the permissions the page asks the other wallet for, or reads from it", async () => {
    const other = { ...wander(), getPermissions: vi.fn().mockResolvedValue(["ACCESS_ADDRESS"]) };
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    await expect((current()!.getPermissions as () => Promise<unknown>)()).resolves.toEqual(["ACCESS_ADDRESS"]);
    await current()!.connect!(["ACCESS_ADDRESS", "SIGNATURE"], { name: "ArDrive" });
    await current()!.connect!(["ACCESS_ADDRESS", "SIGNATURE"]);

    expect(otherWalletReports().filter((report: object) => "permissions" in report)).toEqual([
      { type: OTHER_WALLET, walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS"] },
      { type: OTHER_WALLET, walletName: "Wander", used: true, permissions: ["ACCESS_ADDRESS", "SIGNATURE"] },
    ]);
  });

  it("doesn't count a call outside the wallet API as use", () => {
    const other = { ...wander(), helper: vi.fn() };
    installOther(other);
    teardown = install();
    sendSiteMode(false);
    String(current());
    (current() as unknown as { helper: () => void }).helper();
    Object.prototype.hasOwnProperty.call(current(), "connect");
    current()!.valueOf();

    expect(otherWalletReports()).toEqual([{ type: OTHER_WALLET, walletName: "Wander", used: false }]);
  });

  it("offers Gleam's methods before the site mode is known, and calls them on Gleam if the site uses it", async () => {
    const other = wander();
    installOther(other);
    teardown = install();

    expect(current()?.walletName).toBe("Wander");
    expect("signMessage" in current()!).toBe(true);
    expect(typeof current()!.signMessage).toBe("function");

    const signMessage = current()!.signMessage as () => Promise<unknown>;
    void signMessage();
    expect(gleamRequests()).toHaveLength(0);
    sendSiteMode(true);
    await vi.waitFor(() => expect(gleamRequests()).toHaveLength(1));
    expect(current()?.walletName).toBe("Gleam");
  });

  it("rejects a held call the site's wallet turns out not to have", async () => {
    installOther(wander());
    teardown = install();
    const pending = (current()!.signMessage as () => Promise<unknown>)();
    sendSiteMode(false);

    await expect(pending).rejects.toThrow(TypeError);
    expect("signMessage" in current()!).toBe(false);
    expect(current()!.signMessage).toBeUndefined();
    expect(gleamRequests()).toHaveLength(0);
  });

  it("passes non-function properties of the other wallet through", () => {
    const other = wander();
    installOther(other);
    teardown = install();
    expect(current()?.events).toBe(other.events);
    expect("connect" in current()!).toBe(true);
  });

  it("captures a wallet that assigns the slot later, without throwing in strict mode", async () => {
    teardown = install();
    sendSiteMode(false);
    const other = wander();
    expect(() => {
      (window as unknown as { arweaveWallet: unknown }).arweaveWallet = other;
    }).not.toThrow();

    expect(current()?.walletName).toBe("Wander");
    await current()!.connect!();
    expect(other.connect).toHaveBeenCalled();
  });

  it("keeps the slot and forwards to a wallet that redefines it and announces arweaveWalletLoaded", async () => {
    teardown = install();
    sendSiteMode(false);
    const router = current();

    const other = wander();
    installOther(other);
    window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));

    expect(current()).toBe(router);
    await current()!.connect!();
    expect(other.connect).toHaveBeenCalled();
  });

  function permawebOS() {
    const permaweb = { walletName: "ArConnect", connect: vi.fn().mockResolvedValue("permaweb-connected") };
    (window as unknown as { permawebConnect: unknown }).permawebConnect = permaweb;
    return permaweb;
  }

  it("finds PermawebOS at window.permawebConnect when it skipped the taken slot, and announces it", async () => {
    vi.useFakeTimers();
    teardown = install();
    const onLoaded = listen("arweaveWalletLoaded");
    const pending = current()!.connect!();
    permawebOS();
    await vi.advanceTimersByTimeAsync(150);
    expect(modeRequests()).toHaveLength(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    sendSiteMode(false);

    await expect(pending).resolves.toBe("permaweb-connected");
    expect(gleamRequests()).toHaveLength(0);
    expect(otherWalletReports()).toEqual([
      { type: OTHER_WALLET, walletName: "PermawebOS", used: false },
      { type: OTHER_WALLET, walletName: "PermawebOS", used: true },
    ]);
  });

  it("ignores a site mode message posted by another frame", async () => {
    const other = wander();
    installOther(other);
    teardown = install();
    window.dispatchEvent(new MessageEvent("message", { data: { type: SITE_MODE, useGleam: true }, source: null }));
    sendSiteMode(false);

    await current()!.connect!();
    expect(other.connect).toHaveBeenCalled();
  });

  it("exposes Gleam at window.gleam, which reaches Gleam even while the site uses another wallet", () => {
    const other = wander();
    installOther(other);
    teardown = install();
    sendSiteMode(false);

    const gleam = (window as unknown as { gleam?: Wallet }).gleam;
    expect(gleam?.walletName).toBe("Gleam");
    void gleam!.connect!(["ACCESS_ADDRESS"]);
    expect(gleamRequests()).toHaveLength(1);
    expect(other.connect).not.toHaveBeenCalled();
  });

  it("keeps window.gleam from being replaced by assignment", () => {
    teardown = install();
    const gleam = (window as unknown as { gleam?: unknown }).gleam;
    expect(() => {
      (window as unknown as { gleam: unknown }).gleam = { walletName: "Imposter" };
    }).toThrow();
    expect((window as unknown as { gleam?: unknown }).gleam).toBe(gleam);
  });

  it("leaves a non-configurable provider alone instead of throwing", () => {
    installOther({ walletName: "Wander" });
    const onLoaded = vi.fn();
    const realDefineProperty = Object.defineProperty;
    const defineProperty = vi
      .spyOn(Object, "defineProperty")
      .mockImplementation((target, key, descriptor) => {
        if (key === "arweaveWallet") {
          throw new TypeError("Cannot redefine property: arweaveWallet");
        }
        return realDefineProperty(target, key, descriptor);
      });
    window.addEventListener("arweaveWalletLoaded", onLoaded);
    try {
      expect(() => {
        teardown = install();
      }).not.toThrow();
      expect(current()?.walletName).toBe("Wander");
      expect(onLoaded).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("arweaveWalletLoaded", onLoaded);
      defineProperty.mockRestore();
    }
  });
});
