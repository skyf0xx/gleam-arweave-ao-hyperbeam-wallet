import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { DEFAULT_HYPERBEAM_PEER_URLS } from '../../packages/core/src/models/network';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    // 'tabs' lets the background worker resolve tab.url/origin for
    // provider-event delivery (background/index.ts's findTabsForOrigin)
    // without needing a granted host_permission per origin — MV3's
    // tab-info privacy gate accepts either.
    permissions: ['storage', 'sidePanel', 'tabs'],
    // MV3 requires an explicit host permission for every origin the
    // background service worker fetches. The hosts fetched
    // unconditionally (Arweave gateway, the up.arweave.net bundler used
    // for uploads — a distinct host from arweave.net under MV3's exact
    // match-pattern rules, not covered by 'https://arweave.net/*' —
    // CoinGecko, CoinPaprika, and the default HyperBEAM peers AO balance
    // reads use out of the box, from packages/core's
    // DEFAULT_HYPERBEAM_PEER_URLS) are known at build time and granted
    // statically. Any *other* HyperBEAM peer a user adds is an arbitrary
    // origin chosen in Network settings, not knowable at build time, so
    // it is requested at runtime via chrome.permissions.request() against
    // optional_host_permissions instead of being granted broadly up
    // front.
    host_permissions: [
      'https://arweave.net/*',
      'https://up.arweave.net/*',
      'https://api.coingecko.com/*',
      'https://api.coinpaprika.com/*',
      ...DEFAULT_HYPERBEAM_PEER_URLS.map((url) => `${url}/*`),
    ],
    optional_host_permissions: ['https://*/*'],
    // Required for content.ts's injectScript("/provider.js", ...) to
    // resolve at runtime — WXT does not add this automatically (see its
    // own inject-script.mjs doc comment).
    web_accessible_resources: [
      {
        resources: ['provider.js'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
  },
  vite: () => ({
    plugins: [
      tailwindcss(),
      // @dha-team/arbundles's browser build (arbundles/web) still
      // statically imports Node's crypto/stream/events in a few internal
      // files (deepHash.js, DataItem.js, Bundle.js) even though its own
      // runtime logic uses WebCrypto — polyfilling those three modules is
      // what actually lets it bundle for a service worker/browser target.
      nodePolyfills({ include: ['crypto', 'stream', 'events'] }),
    ],
    build: {
      // Extension pages are same-origin and load in milliseconds; Vite's
      // <link modulepreload> injection for shared chunks (App.js,
      // risk-notice.js) trips Chrome's "preload not used within a few
      // seconds" warning in these short-lived popup/approval windows even
      // though the chunks are consumed synchronously on load.
      modulePreload: false,
    },
  }),
});
