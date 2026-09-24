import { defineExtensionMessaging } from "@webext-core/messaging";
import type { RuntimeMessage, RuntimePort } from "@gleam/core";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";

/**
 * Implements `RuntimePort` over `@webext-core/messaging`'s
 * `defineExtensionMessaging<ProtocolMap>()` — the only place
 * `@webext-core/messaging` (itself wrapping `browser.runtime.sendMessage`/
 * `onMessage`) is reached in this repo. `core` never imports this file;
 * it only sees `RuntimePort`.
 *
 * `RuntimePort` is intentionally generic (`RuntimeMessage<TPayload>`,
 * a `type` string), while `ProtocolMap` is a typed, per-method contract
 * (`createWallet(req): WalletSummary`, not a single generic message
 * shape). This adapter is the seam that reconciles the two: `send`
 * treats `message.type` as a `ProtocolMap` key and `message.payload` as
 * that method's request type, and `onMessage` registers the handler
 * under the same key. `target` (a context name string on `RuntimePort`)
 * has no equivalent on `ExtensionMessenger.sendMessage` — it only takes
 * an optional numeric `tabId` — so it's accepted for interface
 * conformance but unused: every `ProtocolMap` call in this layer is
 * popup-to-background, which never needs a `tabId`.
 */
const messenger = defineExtensionMessaging<ProtocolMap>();

export class WebextCoreRuntimePort implements RuntimePort {
  async send<TPayload, TResponse>(
    message: RuntimeMessage<TPayload>,
    ...target: [string?]
  ): Promise<TResponse> {
    void target; // see class doc comment: `target` has no `ExtensionMessenger` equivalent.
    const type = message.type as keyof ProtocolMap;
    return messenger.sendMessage(type, message.payload as never) as Promise<TResponse>;
  }

  onMessage<TPayload, TResponse>(
    type: string,
    handler: (payload: TPayload) => TResponse | Promise<TResponse>,
  ): () => void {
    return messenger.onMessage(type as keyof ProtocolMap, (message) =>
      handler(message.data as TPayload) as never,
    );
  }
}

export const runtimePort: RuntimePort = new WebextCoreRuntimePort();
