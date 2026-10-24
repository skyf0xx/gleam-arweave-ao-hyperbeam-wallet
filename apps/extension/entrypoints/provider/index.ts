import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { createWindowMessageTransport, installProvider } from "@gleam/provider";
// Named so Vite inlines only the version, not the whole package.json. WXT
// sets the manifest version from the same field.
import { version as WALLET_VERSION } from "../../package.json";

/**
 * Built into `provider.js`, the page-world script that installs
 * `window.arweaveWallet` and `window.gleam`. Loaded via `content/index.ts`'s
 * `injectScript("/provider.js", { keepInDom: false })` — never via
 * `world: "MAIN"` (Chromium-only, can't reach extension APIs the way
 * `injectScript`'s `<script src>` tag can via `web_accessible_resources`).
 * Its calls reach the content script as `postMessage` envelopes.
 *
 * `defineUnlistedScript` is imported explicitly rather than relied on as
 * WXT's unimport-injected global, which only exists inside WXT's own
 * build, so `index.test.ts` can import this file under plain Vitest.
 */
export default defineUnlistedScript(() => {
  installProvider({ transport: createWindowMessageTransport(), walletVersion: WALLET_VERSION });
});
