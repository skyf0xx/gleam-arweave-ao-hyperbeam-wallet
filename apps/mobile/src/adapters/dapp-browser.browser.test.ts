import { describe, expect, it, vi } from "vitest";
import type { DappBrowserEvent } from "@gleam/app/src/app-platform/types.ts";
import type { DappBridge } from "./dapp-bridge";
import { createDappBrowser, type DappBrowserPlugin } from "./dapp-browser";

const FRAME = { x: 0, y: 100, width: 390, height: 600 };

function setup() {
  const calls: string[] = [];
  const bridge = {
    open: vi.fn(async () => void calls.push("bridge.open")),
    close: vi.fn(async () => void calls.push("bridge.close")),
    setHidden: vi.fn(async (hidden: boolean) => void calls.push(`hidden:${hidden}`)),
  } as unknown as DappBridge;
  const listeners = new Map<string, (event: unknown) => void>();
  const remove = vi.fn(async () => {});
  const plugin = {
    goBack: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    setFrame: vi.fn(async () => {}),
    clearData: vi.fn(async () => void calls.push("plugin.clearData")),
    addListener: vi.fn(async (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
      return { remove };
    }),
  } as unknown as DappBrowserPlugin;
  return { browser: createDappBrowser({ bridge, plugin }), bridge, plugin, calls, listeners, remove };
}

describe("createDappBrowser", () => {
  it("opens and closes pages through the bridge", async () => {
    const { browser, bridge } = setup();
    await browser.open({ url: "https://a.example/", frame: FRAME });
    expect(bridge.open).toHaveBeenCalledWith({ url: "https://a.example/", frame: FRAME });
    await browser.close();
    expect(bridge.close).toHaveBeenCalled();
  });

  it("keeps a page opened under the approval sheet hidden", async () => {
    const { browser, calls } = setup();
    await browser.setSheetUp(true);
    calls.length = 0;
    await browser.open({ url: "https://a.example/", frame: FRAME });
    expect(calls).toEqual(["bridge.open", "hidden:true"]);
  });

  it("leaves a page opened with no sheet up as it is", async () => {
    const { browser, calls } = setup();
    await browser.open({ url: "https://a.example/", frame: FRAME });
    expect(calls).toEqual(["bridge.open"]);
  });

  it("shows the page again only when neither the sheet nor the screen covers it", async () => {
    const { browser, calls } = setup();
    await browser.setHidden(true);
    await browser.setSheetUp(true);
    await browser.setHidden(false);
    await browser.setSheetUp(false);
    expect(calls).toEqual(["hidden:true", "hidden:true", "hidden:true", "hidden:false"]);
  });

  it("closes through the bridge before wiping site data", async () => {
    const { browser, calls } = setup();
    await browser.clearSiteData();
    expect(calls).toEqual(["bridge.close", "plugin.clearData"]);
  });

  it("relays navigation and load errors, and stops listening on unsubscribe", async () => {
    const { browser, listeners, remove } = setup();
    const seen: DappBrowserEvent[] = [];
    const unsubscribe = browser.subscribe((event) => seen.push(event));
    await Promise.resolve();
    listeners.get("navigation")?.({ url: "https://a.example/", canGoBack: true, loading: false });
    listeners.get("loadError")?.({ url: "https://b.example/", message: "offline" });
    expect(seen).toEqual([
      { kind: "navigation", url: "https://a.example/", canGoBack: true, loading: false },
      { kind: "loadError", url: "https://b.example/", message: "offline" },
    ]);
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve));
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
