import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { DEFAULT_HYPERBEAM_PEER_URLS } from '../../packages/core/src/models/network';
import { FALLBACK_GATEWAY_URLS } from '../../packages/core/src/arweave/first-run-gateway';
import { FALLBACK_GATEWAYS as GRAPHQL_FALLBACK_GATEWAYS } from '../../packages/core/src/arweave/graphql';
import { extensionPagesCsp } from './src/csp';
import { DEV_SITE_HOSTS, SITE_ORIGIN } from './src/site-pages';

// Only the sha, never a dirty-tree marker: two builds of one commit must
// produce identical bytes for reproducible release builds.
function buildCommit(): string {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ command, mode }) => ({
    // WXT falls back to package.json's "name" ("@gleam/extension") when
    // this is unset, which Chrome then shows as the extension's name.
    name: 'Gleam',
    // runtime.getContexts, which the keyring adapter uses to find its
    // offscreen document, arrived in Chrome 116.
    minimum_chrome_version: '116',
    // 'tabs' lets the background worker resolve tab.url/origin for
    // provider-event delivery (background/index.ts's findTabsForOrigin)
    // without needing a granted host_permission per origin — MV3's
    // tab-info privacy gate accepts either. 'alarms' backs the
    // background interval check that promotes pending activity entries
    // to confirmed once the gateway indexes them, and the auto-lock tick.
    // 'offscreen' backs the keyring document (entrypoints/keyring), which
    // holds unlocked wallets' non-extractable keys in memory only.
    permissions: ['storage', 'sidePanel', 'tabs', 'alarms', 'offscreen', 'idle'],
    // 'downloads' lets the background save a keyfile backup itself, so the
    // plaintext key never reaches the popup. It is optional because a new
    // required permission disables the extension on update until the user
    // re-approves it; the Download button requests it instead.
    optional_permissions: ['downloads'],
    // MV3 requires an explicit host permission for every origin the
    // background service worker fetches, unless that origin answers with
    // CORS headers (the Gleam API does, price proxy included; see POINTS_API_URL). The
    // hosts fetched
    // unconditionally (Arweave gateway, the up.arweave.net bundler used
    // for uploads — a distinct host from arweave.net under MV3's exact
    // match-pattern rules, not covered by 'https://arweave.net/*' —
    // and the default
    // HyperBEAM peers AO balance reads use out of the box, from
    // packages/core's
    // DEFAULT_HYPERBEAM_PEER_URLS) are known at build time and granted
    // statically. Any *other* HyperBEAM peer a user adds is an arbitrary
    // origin chosen in Network settings, not knowable at build time, so
    // it is requested at runtime via chrome.permissions.request() against
    // optional_host_permissions instead of being granted broadly up
    // front.
    //
    // FALLBACK_GATEWAY_URLS (packages/core/src/arweave/first-run-gateway.ts)
    // are checked unconditionally on first run, before the user has
    // granted anything, so each one needs a static host permission here too
    // or it would pass that gateway check and then fail on the real reads
    // that follow. GRAPHQL_FALLBACK_GATEWAYS (packages/core/src/arweave/graphql.ts)
    // are retried whenever the user's gateway fails a GraphQL query, so
    // they're granted statically for the same reason.
    host_permissions: [
      ...new Set([
        'https://arweave.net/*',
        'https://up.arweave.net/*',
        ...DEFAULT_HYPERBEAM_PEER_URLS.map((url) => `${url}/*`),
        ...FALLBACK_GATEWAY_URLS.map((url) => `${url}/*`),
        ...GRAPHQL_FALLBACK_GATEWAYS.map((url) => `${url}/*`),
      ]),
    ],
    optional_host_permissions: ['https://*/*'],
    // Lets the site's pages hand over a Gleam Points invite code
    // (src/points-invite.ts) or a scan attestation to sign
    // (src/points-attest.ts). Only this origin can message the extension;
    // a development build also lets a local copy of the site in
    // (src/site-pages.ts's isSiteOrigin), on any port.
    externally_connectable: {
      matches: [
        `${SITE_ORIGIN}/*`,
        ...(mode === 'development' ? DEV_SITE_HOSTS.map((host) => `http://${host}/*`) : []),
      ],
    },
    // Required for content.ts's injectScript("/provider.js", ...) to
    // resolve at runtime — WXT does not add this automatically (see its
    // own inject-script.mjs doc comment). use_dynamic_url makes Chrome
    // serve it from a per-session id, so a page can't probe
    // chrome-extension://<id>/provider.js to detect Gleam.
    web_accessible_resources: [
      {
        resources: ['provider.js'],
        matches: ['http://*/*', 'https://*/*'],
        use_dynamic_url: true,
      },
    ],
    content_security_policy: {
      extension_pages: extensionPagesCsp(command),
    },
  }),
  vite: () => ({
    define: {
      'import.meta.env.VITE_GLEAM_COMMIT': JSON.stringify(buildCommit()),
    },
    plugins: [
      tailwindcss(),
      // The Keystone UR registry hashes through bs58check → create-hash →
      // cipher-base, which subclasses stream.Transform at import time, so
      // Keystone pages need `stream` (and the `events` it builds on). The
      // plugin's default globals also supply the `Buffer` those libraries
      // and keystone/sign-request.ts use.
      nodePolyfills({ include: ['stream', 'events'] }),
    ],
    resolve: {
      alias: [{ find: /^function-bind$/, replacement: fileURLToPath(new URL('./src/shims/function-bind.cjs', import.meta.url)) }],
    },
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
