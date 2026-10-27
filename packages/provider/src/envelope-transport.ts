import {
  EVENT,
  OTHER_WALLET,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
  type PageEventEnvelope,
  type PageMessageEnvelope,
  type PageOtherWalletEnvelope,
  type PageRequestEnvelope,
  type PageResponseEnvelope,
  type PageSiteModeRequestEnvelope,
} from "@gleam/messaging/src/page-protocol.ts";
import type { OtherWalletReport, ProviderTransport } from "./transport";

/**
 * 128 random bits as hex. Not `crypto.randomUUID()`: that exists only in
 * secure contexts, so on a plain-http page it would throw before the
 * request reached the wallet's "secure (https) sites" refusal.
 */
function requestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  forget: () => void;
}

/**
 * A `ProviderTransport` over any channel that carries page envelopes: each
 * call goes out as a `PageRequestEnvelope` and is settled by the
 * `PageResponseEnvelope` with its fresh random `id`. `send` may throw, which
 * rejects that call. `subscribe` hands over every envelope the channel
 * receives; the channel decides first what counts as the wallet's.
 */
export function createEnvelopeTransport(
  send: (envelope: PageMessageEnvelope) => void,
  subscribe: (receive: (envelope: unknown) => void) => void,
): ProviderTransport {
  const pending = new Map<string, PendingRequest>();
  const eventListeners = new Set<(event: string, data: unknown) => void>();
  const siteModeListeners = new Set<(useGleam: boolean) => void>();

  subscribe((received) => {
    const envelope = received as PageMessageEnvelope | undefined;
    if (!envelope || typeof envelope !== "object") return;

    if (envelope.type === RESPONSE) {
      const response = envelope as PageResponseEnvelope;
      const call = pending.get(response.id);
      // A duplicate or late response finds nothing left to settle.
      if (!call) return;
      pending.delete(response.id);
      call.forget();
      if (response.error) {
        call.reject(new Error(response.error.message));
      } else {
        call.resolve(response.result);
      }
    } else if (envelope.type === EVENT) {
      const pushed = envelope as PageEventEnvelope;
      for (const listener of [...eventListeners]) listener(pushed.event, pushed.data);
    } else if (envelope.type === SITE_MODE && typeof envelope.useGleam === "boolean") {
      for (const listener of [...siteModeListeners]) listener(envelope.useGleam);
    }
  });

  return {
    request(method, params, callSignal) {
      return new Promise((resolve, reject) => {
        const id = requestId();
        const onAbort = () => pending.delete(id);
        const forget = () => callSignal.removeEventListener("abort", onAbort);
        pending.set(id, { resolve, reject, forget });
        callSignal.addEventListener("abort", onAbort, { once: true });
        const request: PageRequestEnvelope = { type: REQUEST, id, method, params };
        try {
          send(request);
        } catch (error) {
          pending.delete(id);
          forget();
          reject(error);
        }
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    requestSiteMode() {
      const envelope: PageSiteModeRequestEnvelope = { type: SITE_MODE_REQUEST };
      send(envelope);
    },
    onSiteMode(listener) {
      siteModeListeners.add(listener);
      return () => siteModeListeners.delete(listener);
    },
    reportOtherWallet(report: OtherWalletReport) {
      const envelope: PageOtherWalletEnvelope = { type: OTHER_WALLET, ...report };
      send(envelope);
    },
  };
}
