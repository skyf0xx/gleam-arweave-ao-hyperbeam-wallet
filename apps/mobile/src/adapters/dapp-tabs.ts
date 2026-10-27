/**
 * The runtime worker's view of the dApp view as a browser tab. It imports
 * no plugin, so the worker bundle stays free of Capacitor, whose native
 * bridge only exists on the page; the UI thread serves the tab
 * (`serveDappTabs`).
 */
import * as Comlink from "comlink";
import type { TabsPort } from "@gleam/runtime";

/**
 * True for an http(s) origin in its exact serialized form. "null", file:,
 * data:, about: and other schemes fail, and so does anything with a path,
 * a trailing slash, a default port or different case.
 */
export function isExactWebOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string") return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === origin;
  } catch {
    return false;
  }
}

/** The message a worker sends to ask for the tabs, carrying its end of the channel. */
export const TABS_REQUEST = "gleam:dapp-tabs";

/** `TabsPort` for the runtime worker: the one tab is the dApp view's page. */
export function createWorkerTabs(scope: { postMessage(message: unknown, transfer: Transferable[]): void }): TabsPort {
  const channel = new MessageChannel();
  scope.postMessage({ type: TABS_REQUEST, port: channel.port2 }, [channel.port2]);
  const tabs = Comlink.wrap<TabsPort>(channel.port1);
  return {
    webTabs: () => tabs.webTabs(),
    activeTab: () => tabs.activeTab(),
    reload: (tabId) => tabs.reload(tabId),
    send: (tabId, type, data) => tabs.send(tabId, type, data),
  };
}
