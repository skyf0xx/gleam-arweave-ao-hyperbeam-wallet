import { NATIVE_BRIDGE_EVENT, NATIVE_BRIDGE_HANDLER } from "@gleam/messaging/src/page-protocol.ts";
import { createEnvelopeTransport } from "./envelope-transport";
import type { ProviderTransport } from "./transport";

type Handler = { postMessage?: unknown };
type BridgeWindow = { webkit?: { messageHandlers?: Record<string, Handler | undefined> } } & Record<string, unknown>;

/**
 * The native handler's send, bound now. The script runs at document start,
 * before any page script, so a page that later replaces the handler,
 * `postMessage`, `Function.prototype.call` or `JSON` can't intercept or
 * rewrite what the provider sends.
 */
function captureSend(): ((text: string) => void) | null {
  const bridgeWindow = window as unknown as BridgeWindow;
  const handler =
    bridgeWindow.webkit?.messageHandlers?.[NATIVE_BRIDGE_HANDLER] ?? (bridgeWindow[NATIVE_BRIDGE_HANDLER] as Handler | undefined);
  const post = handler?.postMessage;
  if (typeof post !== "function") return null;
  const apply = Reflect.apply;
  return (text) => {
    apply(post, handler, [text]);
  };
}

/**
 * The page half of the mobile dApp view's bridge. Each envelope goes to
 * native as JSON text, and the wallet's replies come back as a
 * `NATIVE_BRIDGE_EVENT` on this window. The transport sends no origin:
 * native attaches the frame's own, and delivers a reply only while this
 * frame is still on the origin the request came from.
 *
 * Any script in this document can also dispatch that event, so a page can
 * forge replies to its own provider, as it can with the extension's
 * same-window `postMessage`. That fools only the page itself.
 *
 * `signal` removes the event listener; tests use it to tear down.
 */
export function createNativeBridgeTransport(signal?: AbortSignal): ProviderTransport {
  const send = captureSend();
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  return createEnvelopeTransport(
    (envelope) => {
      if (!send) throw new Error("Gleam can't reach the wallet from this page.");
      send(stringify(envelope));
    },
    (receive) =>
      window.addEventListener(
        NATIVE_BRIDGE_EVENT,
        (event) => {
          const detail = (event as CustomEvent<unknown>).detail;
          if (typeof detail !== "string") return;
          let envelope: unknown;
          try {
            envelope = parse(detail);
          } catch {
            return;
          }
          receive(envelope);
        },
        { signal },
      ),
  );
}
