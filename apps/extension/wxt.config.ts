import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['storage', 'sidePanel'],
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
