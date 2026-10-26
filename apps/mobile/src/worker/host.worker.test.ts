// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { WalletState } from "@gleam/core";
import { createRuntime } from "@gleam/runtime/src/create-runtime.ts";
import { createInMemoryPlatform } from "@gleam/runtime/testing/index.ts";
import { createWorkerRuntimePort } from "../adapters/runtime-port";
import { exposeRuntimeHost } from "./host";

const channels: MessageChannel[] = [];

/** The UI's `RuntimePort` and the worker's host, joined by a real `MessageChannel`. */
function connect() {
  const runtime = createRuntime(createInMemoryPlatform());
  const channel = new MessageChannel();
  channels.push(channel);
  exposeRuntimeHost(runtime, channel.port1);
  return { port: createWorkerRuntimePort(channel.port2), ui: channel.port2 };
}

/** Posts a hand-built comlink message and records the ids that get an answer. */
function rawSender(ui: MessagePort) {
  const answered = new Set<string>();
  ui.addEventListener("message", (event: MessageEvent<{ id?: string }>) => {
    if (event.data?.id?.startsWith("raw-")) answered.add(event.data.id);
  });
  return { answered, post: (message: Record<string, unknown>) => ui.postMessage(message) };
}

const raw = (value: unknown) => ({ type: "RAW", value });

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

describe("worker runtime host", () => {
  it("answers the UI's calls as the wallet's own pages", async () => {
    const { port } = connect();
    const state = await port.send<void, WalletState>({ type: "getState", payload: undefined });
    expect(state.wallets).toEqual([]);
  });

  it("hands a handler's error back with its message", async () => {
    const direct = createRuntime(createInMemoryPlatform());
    const expected = await Promise.resolve()
      .then(() => direct.dispatch("switchWallet", { walletId: "missing" }, { tier: "extension" }))
      .then(() => undefined, (error: Error) => error.message);
    expect(expected).toBeTruthy();

    const { port } = connect();
    await expect(port.send({ type: "switchWallet", payload: { walletId: "missing" } })).rejects.toThrow(expected);
  });

  it("refuses page methods, since the UI isn't a web page", async () => {
    const { port } = connect();
    await expect(port.send({ type: "getSiteWalletMode", payload: undefined })).rejects.toThrow(
      /only accepted from a web page/,
    );
  });

  it.each(["noSuchMessage", "constructor", "__proto__", "toString"])("refuses %s, which isn't a message", async (type) => {
    const { port } = connect();
    await expect(port.send({ type, payload: undefined })).rejects.toThrow(/has no/);
  });

  it("rejects a payload that can't be cloned rather than dropping part of it", async () => {
    const { port } = connect();
    await expect(port.send({ type: "getState", payload: { callback: () => {} } })).rejects.toThrow();
  });

  it("ignores comlink messages that reach past dispatch", async () => {
    const { port, ui } = connect();
    const sender = rawSender(ui);
    sender.post({ id: "raw-get", type: "GET", path: ["dispatch", "constructor", "name"] });
    sender.post({
      id: "raw-construct",
      type: "CONSTRUCT",
      path: ["dispatch", "constructor"],
      argumentList: [raw("return 1")],
    });
    sender.post({ id: "raw-apply", type: "APPLY", path: ["dispatch", "constructor"], argumentList: [raw("return 1")] });
    sender.post({ id: "raw-set", type: "SET", path: ["dispatch"], value: raw(null) });
    sender.post({ id: "raw-release", type: "RELEASE" });
    sender.post({
      id: "raw-handler",
      type: "APPLY",
      path: ["dispatch"],
      argumentList: [raw("getState"), { type: "HANDLER", name: "throw", value: { isError: false, value: 1 } }],
    });

    // Replies keep their order, so once this round trip is back any answer
    // to the messages above would have arrived first. It also shows SET and
    // RELEASE took no effect.
    await expect(port.send({ type: "getState", payload: undefined })).resolves.toBeDefined();
    expect([...sender.answered]).toEqual([]);
  });
});
