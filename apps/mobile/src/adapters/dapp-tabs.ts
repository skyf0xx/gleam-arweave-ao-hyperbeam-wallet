/**
 * The runtime worker's view of the dApp view as a browser tab. It imports
 * no plugin, so the worker bundle stays free of Capacitor, whose native
 * bridge only exists on the page; the UI thread serves the tab
 * (`serveDappTabs`).
 */
import type { TabsPort } from "@gleam/runtime";
import { requestChannel, type WorkerScope } from "./comlink-guard";

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
export function createWorkerTabs(scope: WorkerScope): TabsPort {
  const tabs = requestChannel<TabsPort>(scope, TABS_REQUEST);
  return {
    webTabs: () => tabs.webTabs(),
    activeTab: () => tabs.activeTab(),
    reload: (tabId) => tabs.reload(tabId),
    send: (tabId, type, data) => tabs.send(tabId, type, data),
  };
}
