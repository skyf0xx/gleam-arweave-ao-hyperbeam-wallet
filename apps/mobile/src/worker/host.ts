import type * as Comlink from "comlink";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import type { Runtime } from "@gleam/runtime";
import { BACKGROUND_MESSAGES, type BackgroundMessage } from "@gleam/runtime/src/dispatch/methods.ts";
import { exposeMethods } from "../adapters/comlink-guard";
import { isExactWebOrigin } from "../adapters/dapp-tabs";

/** What the worker exposes to the wallet WebView over `comlink`. */
export interface RuntimeHost {
  dispatch(type: string, data: unknown): Promise<unknown>;
  /**
   * A message from the top frame of the page in the dApp view, on `origin`
   * as native attested it. `tabId` names that page's load (see
   * `createDappBridge`).
   */
  pageCall(type: string, data: unknown, origin: string, tabId: number | undefined): Promise<unknown>;
  /** The dApp view's page with this tab id is gone. */
  tabClosed(tabId: number): Promise<void>;
  /** The app came back from the background. */
  resume(): Promise<void>;
}

/** The worker's own events, which the UI thread can only signal. */
export interface WorkerLifecycle {
  onResume(): void;
}

/**
 * A dedicated worker hears only the page that constructed it, and that is
 * the wallet WebView, which loads nothing but the bundled app. dApps run in
 * a separate native WebView with no handle on this worker, so every call
 * that arrives here is the wallet's own UI.
 */
const WALLET_UI: CallerContext = { tier: "extension" };

function messageType(type: unknown): BackgroundMessage {
  // `type` crossed a structured clone untyped; `hasOwn` also refuses
  // inherited names such as `constructor`.
  if (typeof type !== "string" || !Object.hasOwn(BACKGROUND_MESSAGES, type)) {
    throw new Error(`Gleam has no "${String(type)}" message.`);
  }
  return type as BackgroundMessage;
}

export function createRuntimeHost(runtime: Pick<Runtime, "dispatch" | "onTabClosed">, lifecycle: WorkerLifecycle): RuntimeHost {
  return {
    async resume() {
      lifecycle.onResume();
    },
    async dispatch(type, data) {
      return runtime.dispatch(messageType(type), data, WALLET_UI);
    },
    // The dApp view's page gets the tier the extension gives a web page's
    // content script, so the dispatcher holds it to the same methods,
    // grants and secure-origin check.
    async pageCall(type, data, origin, tabId) {
      if (!isExactWebOrigin(origin)) throw new Error("A page call needs the page's http(s) origin.");
      const caller: CallerContext = { tier: "contentScript", origin, tabId: typeof tabId === "number" ? tabId : undefined };
      return runtime.dispatch(messageType(type), data, caller);
    },
    async tabClosed(tabId) {
      if (typeof tabId === "number") runtime.onTabClosed(tabId);
    },
  };
}

/** Serves `runtime` on `endpoint`, the worker's global scope outside tests. */
export function exposeRuntimeHost(
  runtime: Pick<Runtime, "dispatch" | "onTabClosed">,
  lifecycle: WorkerLifecycle,
  endpoint: Comlink.Endpoint,
): void {
  exposeMethods(createRuntimeHost(runtime, lifecycle), ["dispatch", "pageCall", "tabClosed", "resume"], endpoint);
}
