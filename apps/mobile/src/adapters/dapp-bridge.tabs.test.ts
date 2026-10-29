// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Comlink from "comlink";
import type { TabsPort } from "@gleam/runtime";
import { createDappBridge, serveDappTabs, type DappViewBridgePlugin } from "./dapp-bridge";
import { TABS_REQUEST } from "./dapp-tabs";

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The UI thread's tabs served on one end of a real channel, as the worker would ask for them. */
function served() {
  const tabs: TabsPort = {
    webTabs: vi.fn(async () => [{ id: 1, url: "https://dapp.example/" }]),
    activeTab: vi.fn(async () => undefined),
    reload: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
  };
  const worker = new EventTarget();
  serveDappTabs(worker as Worker, tabs);
  const channel = new MessageChannel();
  channels.push(channel);
  worker.dispatchEvent(new MessageEvent("message", { data: { type: TABS_REQUEST, port: channel.port2 } }));
  return { tabs, worker: channel.port1 };
}

describe("serveDappTabs", () => {
  it("answers the worker's tab calls", async () => {
    const { worker } = served();
    const tabs = Comlink.wrap<TabsPort>(worker);
    await expect(tabs.webTabs()).resolves.toEqual([{ id: 1, url: "https://dapp.example/" }]);
  });

  it("ignores comlink messages that reach past the tab methods", async () => {
    const { worker } = served();
    const answered = new Set<string>();
    worker.addEventListener("message", (event: MessageEvent<{ id?: string }>) => {
      if (event.data?.id?.startsWith("raw-")) answered.add(event.data.id);
    });
    worker.start();
    const raw = (value: unknown) => ({ type: "RAW", value });
    worker.postMessage({ id: "raw-get", type: "GET", path: ["webTabs", "constructor", "name"] });
    worker.postMessage({ id: "raw-apply", type: "APPLY", path: ["webTabs", "constructor"], argumentList: [raw("return 1")] });
    worker.postMessage({ id: "raw-construct", type: "CONSTRUCT", path: ["send", "constructor"], argumentList: [raw("return 1")] });
    worker.postMessage({ id: "raw-other", type: "APPLY", path: ["toString"], argumentList: [] });
    worker.postMessage({ id: "raw-set", type: "SET", path: ["webTabs"], value: raw(null) });

    // Replies keep their order, so any answer to the messages above would
    // have arrived before this one.
    await expect(Comlink.wrap<TabsPort>(worker).webTabs()).resolves.toHaveLength(1);
    expect([...answered]).toEqual([]);
  });
});

describe("the dApp tab after the browser closes", () => {
  function openBridge(closeFails = false) {
    let navigate: (event: unknown) => void = () => {};
    const plugin = {
      open: vi.fn(async () => {}),
      close: vi.fn(async () => {
        if (closeFails) throw new Error("native failed");
      }),
      reload: vi.fn(async () => {}),
      setHidden: vi.fn(async () => {}),
      postMessage: vi.fn(async () => ({ delivered: true })),
      addListener: vi.fn(async (name: string, listener: (event: unknown) => void) => {
        if (name === "navigation") navigate = listener;
        return { remove: async () => {} };
      }),
    } as unknown as DappViewBridgePlugin;
    const runtime = { pageCall: vi.fn(async () => undefined), tabClosed: vi.fn(async () => {}) };
    const bridge = createDappBridge({ plugin, runtime, providerScript: "" });
    return { bridge, runtime, navigate: (url: string) => navigate({ url, canGoBack: false, loading: false }) };
  }

  it("has no active tab once the browser closes, and tells subscribers", async () => {
    const { bridge, navigate, runtime } = openBridge();
    await bridge.listening;
    const onChange = vi.fn();
    bridge.subscribe(onChange);

    navigate("https://bazar.arweave.net/");
    await expect(bridge.tabs.activeTab()).resolves.toMatchObject({ url: "https://bazar.arweave.net/" });
    expect(onChange).toHaveBeenCalledTimes(1);

    await bridge.close();
    await expect(bridge.tabs.activeTab()).resolves.toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(runtime.tabClosed).toHaveBeenCalled();
  });

  it("forgets the tab even when native fails to close", async () => {
    const { bridge, navigate } = openBridge(true);
    await bridge.listening;
    navigate("https://bazar.arweave.net/");
    await expect(bridge.close()).rejects.toThrow("native failed");
    await expect(bridge.tabs.activeTab()).resolves.toBeUndefined();
  });

  it("notifies on open and on same-origin navigation, and stops after unsubscribe", async () => {
    const { bridge, navigate } = openBridge();
    await bridge.listening;
    const onChange = vi.fn();
    const stop = bridge.subscribe(onChange);

    await bridge.open({ url: "https://a.example/", frame: { x: 0, y: 0, width: 1, height: 1 } });
    navigate("https://a.example/");
    navigate("https://a.example/two");
    expect(onChange).toHaveBeenCalledTimes(3);

    stop();
    await bridge.close();
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
