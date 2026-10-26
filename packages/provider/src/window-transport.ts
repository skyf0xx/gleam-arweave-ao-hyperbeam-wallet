import { createEnvelopeTransport } from "./envelope-transport";
import type { ProviderTransport } from "./transport";

/**
 * The page half of the extension's page ↔ content-script bridge: each
 * call is a `PageRequestEnvelope` posted to this window, which the
 * content script relays to the background and answers with a
 * `PageResponseEnvelope` matched on its fresh random `id`.
 *
 * Every message is posted to `location.origin`, so it is dropped if the
 * window has navigated elsewhere by the time it is delivered. An opaque
 * origin ("null", e.g. file:// or a sandboxed page) is not a valid target
 * and throws. Every message read must come from this window itself
 * (`event.source === window`), or a same-document iframe could forge a
 * response, an event or the site mode.
 *
 * `signal` removes the window listener; tests use it to tear down.
 */
export function createWindowMessageTransport(signal?: AbortSignal): ProviderTransport {
  return createEnvelopeTransport(
    (envelope) => window.postMessage(envelope, location.origin),
    (receive) =>
      window.addEventListener(
        "message",
        (event: MessageEvent) => {
          if (event.source !== window) return;
          receive(event.data);
        },
        { signal },
      ),
  );
}
