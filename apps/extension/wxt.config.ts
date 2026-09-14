import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['storage', 'sidePanel'],
    // MV3 requires an explicit host permission for every origin the
    // background service worker fetches. The three hosts fetched
    // unconditionally (Arweave gateway, CoinGecko, CoinPaprika) are
    // known at build time and granted statically. A user-added
    // HyperBEAM peer is an arbitrary origin chosen in Network settings,
    // not knowable at build time, so it is requested at runtime via
    // chrome.permissions.request() against optional_host_permissions
    // instead of being granted broadly up front.
    host_permissions: [
      'https://arweave.net/*',
      'https://api.coingecko.com/*',
      'https://api.coinpaprika.com/*',
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
  }),
});
