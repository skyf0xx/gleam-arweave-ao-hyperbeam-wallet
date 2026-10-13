import { defineExtensionMessaging } from "@webext-core/messaging";
import { defineContentScript } from "wxt/utils/define-content-script";
import { injectScript } from "wxt/utils/inject-script";
import {
  EVENT,
  OTHER_WALLET,
  REQUEST,
  RESPONSE,
  SITE_MODE,
  SITE_MODE_REQUEST,
  PROVIDER_SURFACE_METHODS,
  type PageEventEnvelope,
  type PageMessageEnvelope,
  type PageOtherWalletEnvelope,
  type PageRequestEnvelope,
  type PageResponseEnvelope,
  type PageSiteModeEnvelope,
} from "@gleam/messaging/src/page-protocol.ts";
import type { ProtocolMap } from "@gleam/messaging/src/protocol.ts";

/**
 * The content-script half of the page ↔ content bridge: `document_start`,
 * top frame only (`allFrames: false` — a page's iframes never get their
 * own injected provider or bridge), injects `provider.js` via
 * `injectScript` (never `world: "MAIN"`, `keepInDom: false` so the
 * `<script>` tag is removed from the DOM right after it runs), and
 * relays every `PageRequestEnvelope` the page posts into a real
 * `ProtocolMap.providerCall` message to the background, then relays the
 * response back as a `PageResponseEnvelope`.
 *
 * This relay is the *only* path a page's request can take to reach the
 * background: it always goes through `providerCall`, which is the single
 * choke point `background.ts` enforces `PROVIDER_METHODS` against. The
 * only other calls this script makes are about its own tab:
 * `getSiteWalletMode` and `reportOtherWallet`, which route the page's
 * `window.arweaveWallet` between Gleam and another installed wallet.
 *
 * The relayed call carries no origin. The background takes it from
 * Chrome's `sender` for this frame, so a malicious page cannot claim to
 * be a different origin than the tab it's actually running in.
 *
 * Two testability notes (see `content.provider.test.ts`):
 * `defineContentScript`/`injectScript` are imported explicitly from
 * `wxt/utils/*` (pure, side-effect-free at import time) rather than
 * relied on as WXT's unimport-injected globals, which only exist inside
 * WXT's own build/dev pipeline, never under plain Vitest. Separately,
 * `defineExtensionMessaging<ProtocolMap>()` below throws synchronously
 * outside a real extension context (same `@webext-core/messaging`
 * behavior `App.tsx`'s own doc comment documents) — its test file mocks
 * `@webext-core/messaging` before dynamically importing this module, the
 * same pattern `adapters/runtime.unlock.test.ts` already established.
 */
const messenger = defineExtensionMessaging<ProtocolMap>();

function isPageRequestEnvelope(value: unknown): value is PageRequestEnvelope {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as PageMessageEnvelope).type === REQUEST &&
    typeof (value as PageRequestEnvelope).id === "string" &&
    PROVIDER_SURFACE_METHODS.includes((value as PageRequestEnvelope).method)
  );
}

function isOtherWalletEnvelope(value: unknown): value is PageOtherWalletEnvelope {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as PageMessageEnvelope).type === OTHER_WALLET &&
    typeof (value as PageOtherWalletEnvelope).walletName === "string" &&
    typeof (value as PageOtherWalletEnvelope).used === "boolean" &&
    ((value as PageOtherWalletEnvelope).permissions === undefined ||
      isStringArray((value as PageOtherWalletEnvelope).permissions))
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

async function relay(envelope: PageRequestEnvelope): Promise<void> {
  const response: PageResponseEnvelope = { type: RESPONSE, id: envelope.id };
  try {
    const result = await messenger.sendMessage("providerCall", {
      method: envelope.method,
      params: envelope.params,
    });
    response.result = result;
  } catch (error) {
    response.error = { message: error instanceof Error ? error.message : String(error) };
  }
  window.postMessage(response, location.origin);
}

export function postProviderEvent(event: string, data: unknown): void {
  const envelope: PageEventEnvelope = { type: EVENT, event, data };
  window.postMessage(envelope, location.origin);
}

function postSiteMode(useGleam: boolean): void {
  const envelope: PageSiteModeEnvelope = { type: SITE_MODE, useGleam };
  window.postMessage(envelope, location.origin);
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  allFrames: false,
  async main() {
    // The provider sends each of these once per page; a page posting them
    // itself gets no further than that.
    let modeAsked = false;
    let presenceRelayed = false;
    let useRelayed = false;
    // Permissions can change on a page (connect after getPermissions), so
    // each distinct list goes through once.
    let permissionsRelayed = "";

    // Listeners go first: the provider reports another wallet while it
    // installs, before injectScript resolves.
    window.addEventListener("message", (event: MessageEvent) => {
      // Same origin/source guard as the page-side provider: only ever
      // trust messages this exact window posted to itself.
      if (event.source !== window) return;
      const data = event.data as PageMessageEnvelope | undefined;
      if (isPageRequestEnvelope(data)) {
        void relay(data);
      } else if (data?.type === SITE_MODE_REQUEST && !modeAsked) {
        modeAsked = true;
        messenger.sendMessage("getSiteWalletMode", undefined).then(
          ({ useGleam }) => postSiteMode(useGleam),
          // Without an answer the other wallet keeps the site, so the page
          // shouldn't wait for one.
          () => postSiteMode(false),
        );
      } else if (isOtherWalletEnvelope(data) && data.permissions !== undefined) {
        const key = data.permissions.join(",");
        if (key === permissionsRelayed) return;
        permissionsRelayed = key;
        messenger
          .sendMessage("reportOtherWallet", { walletName: data.walletName, used: true, permissions: data.permissions })
          .catch(() => undefined);
      } else if (isOtherWalletEnvelope(data) && !(data.used ? useRelayed : presenceRelayed)) {
        presenceRelayed = true;
        if (data.used) useRelayed = true;
        messenger
          .sendMessage("reportOtherWallet", { walletName: data.walletName, used: data.used })
          .catch(() => undefined);
      }
    });

    // The background → content-script half of `ProtocolMap.providerEvent`
    // (`background/index.ts`'s broadcast helper): background only ever
    // targets this exact tab (via `sendMessage(..., tabId)`), so receiving
    // this message at all already means this tab's origin held an active
    // Grant at send time — no further access check belongs here, relaying
    // straight into `postProviderEvent` is correct.
    messenger.onMessage("providerEvent", (message) => {
      postProviderEvent(message.data.event, message.data.data);
    });
    messenger.onMessage("siteWalletMode", (message) => {
      postSiteMode(message.data.useGleam);
    });

    await injectScript("/provider.js", { keepInDom: false });
  },
});
