import * as Comlink from "comlink";

/**
 * Comlink's `expose` follows any property path and can get, set, call or
 * construct whatever it reaches, so `["dispatch", "constructor"]` would hand
 * the other side `Function` and code execution here. Only a call to one of
 * `methods`, by a one-segment path with plain cloned arguments, gets
 * through. A comlink proxy or transfer handler as an argument doesn't.
 */
function isAllowedCall(data: unknown, methods: ReadonlySet<unknown>): boolean {
  if (typeof data !== "object" || data === null) return false;
  const { type, path, argumentList } = data as Record<string, unknown>;
  return (
    type === "APPLY" &&
    Array.isArray(path) &&
    path.length === 1 &&
    methods.has(path[0]) &&
    Array.isArray(argumentList) &&
    argumentList.every((arg) => typeof arg === "object" && arg !== null && (arg as { type?: unknown }).type === "RAW")
  );
}

/** `Comlink.expose`, answering only calls to `methods` of `target`. */
export function exposeMethods<T extends object>(target: T, methods: ReadonlyArray<keyof T & string>, endpoint: Comlink.Endpoint): void {
  const allowed: ReadonlySet<unknown> = new Set(methods);
  // Registered before comlink's own listener, so it runs first and can stop it.
  endpoint.addEventListener("message", (event) => {
    if (!isAllowedCall((event as MessageEvent).data, allowed)) event.stopImmediatePropagation();
  });
  Comlink.expose(target, endpoint);
}

/** What a runtime worker posts to the UI thread to open a channel. */
export type WorkerScope = { postMessage(message: unknown, transfer: Transferable[]): void };

/**
 * Asks the UI thread, with a message of `type`, for a channel and returns
 * the proxy on this end of it. `serveOnce` answers on the other end.
 */
export function requestChannel<T>(scope: WorkerScope, type: string): Comlink.Remote<T> {
  const channel = new MessageChannel();
  scope.postMessage({ type, port: channel.port2 }, [channel.port2]);
  return Comlink.wrap<T>(channel.port1);
}

/**
 * Answers the first message of `type` that carries a `MessagePort` by
 * exposing `methods` of `target` on it; later requests are ignored.
 */
export function serveOnce<T extends object>(
  worker: Worker,
  type: string,
  target: T,
  methods: ReadonlyArray<keyof T & string>,
): void {
  let served = false;
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; port?: unknown } | null;
    if (served || data?.type !== type || !(data.port instanceof MessagePort)) return;
    served = true;
    exposeMethods(target, methods, data.port);
  });
}
