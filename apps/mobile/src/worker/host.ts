import * as Comlink from "comlink";
import type { CallerContext } from "@gleam/messaging/src/caller.ts";
import type { Runtime } from "@gleam/runtime";
import { BACKGROUND_MESSAGES, type BackgroundMessage } from "@gleam/runtime/src/dispatch/methods.ts";

/** What the worker exposes to the wallet WebView over `comlink`. */
export interface RuntimeHost {
  dispatch(type: string, data: unknown): Promise<unknown>;
}

/**
 * A dedicated worker hears only the page that constructed it, and that is
 * the wallet WebView, which loads nothing but the bundled app. dApps run in
 * a separate native WebView with no handle on this worker, so every call
 * that arrives here is the wallet's own UI.
 */
const WALLET_UI: CallerContext = { tier: "extension" };

export function createRuntimeHost(runtime: Pick<Runtime, "dispatch">): RuntimeHost {
  return {
    async dispatch(type, data) {
      // `type` crossed a structured clone untyped; `hasOwn` also refuses
      // inherited names such as `constructor`.
      if (typeof type !== "string" || !Object.hasOwn(BACKGROUND_MESSAGES, type)) {
        throw new Error(`Gleam has no "${String(type)}" message.`);
      }
      return runtime.dispatch(type as BackgroundMessage, data, WALLET_UI);
    },
  };
}

/**
 * Comlink's `expose` follows any property path and can get, set, call or
 * construct whatever it reaches, so `["dispatch", "constructor"]` would hand
 * the UI `Function` and code execution in the worker that holds the keys.
 * Only a call to `dispatch` itself, with plain cloned arguments, gets
 * through. A comlink proxy or transfer handler as an argument doesn't.
 */
function isDispatchCall(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const { type, path, argumentList } = data as Record<string, unknown>;
  return (
    type === "APPLY" &&
    Array.isArray(path) &&
    path.length === 1 &&
    path[0] === "dispatch" &&
    Array.isArray(argumentList) &&
    argumentList.every((arg) => typeof arg === "object" && arg !== null && (arg as { type?: unknown }).type === "RAW")
  );
}

/** Serves `runtime` on `endpoint`, the worker's global scope outside tests. */
export function exposeRuntimeHost(runtime: Pick<Runtime, "dispatch">, endpoint: Comlink.Endpoint): void {
  // Registered before comlink's own listener, so it runs first and can stop it.
  endpoint.addEventListener("message", (event) => {
    if (!isDispatchCall((event as MessageEvent).data)) event.stopImmediatePropagation();
  });
  Comlink.expose(createRuntimeHost(runtime), endpoint);
}
