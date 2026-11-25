// @ts-check
// What each built entry of the extension may contain; scripts/check-bundles.mjs
// checks the build against it.

/** Modules the keyring page may load, as repo-relative paths or virtual ids. */
export const KEYRING_ALLOWED = [
  /^apps\/extension\/(entrypoints|src)\/keyring\//,
  /^packages\/core\/src\/signer\//,
  /^packages\/core\/src\/vault\/(base64|signer|message-signing)\.ts$/,
  /^packages\/core\/src\/(models|ports)\//,
  /^packages\/messaging\/src\/keyring-protocol\.ts$/,
  // Argon2id for the vault envelope.
  /node_modules\/hash-wasm\//,
  // `browser.runtime`, a re-export of the `chrome` global.
  /node_modules\/wxt\/dist\/browser\.mjs$/,
  /node_modules\/@wxt-dev\/browser\//,
  /^\0?virtual:wxt-(html-)?plugins\?entrypoint=keyring$/,
  /^\0rolldown\/runtime/,
];

/**
 * Each page-injected file's size budget and the npm packages it may contain.
 * @type {Record<string, { maxBytes: number, packages: string[] }>}
 */
export const PAGE_SCRIPTS = {
  "provider.js": { maxBytes: 16 * 1024, packages: ["wxt"] },
  "content-scripts/content.js": {
    maxBytes: 12 * 1024,
    packages: ["wxt", "@wxt-dev/browser", "@webext-core/messaging", "@aklinker1/zero-serialize-error"],
  },
};

/**
 * The npm packages each other built entry may contain: the background worker
 * (dispatcher, signing) and every page that renders what a user approves or
 * sees, up front: a chunk it loads through `import()` has its own list in
 * LAZY_PACKAGES. Adding a package is a reviewed change to this file. A package
 * that no longer appears fails the check too, so a list never holds more than
 * the bundle does.
 */
const POPUP_PACKAGES = [
  "@aklinker1/zero-serialize-error",
  "@dicebear/core",
  "@dicebear/styles",
  "@radix-ui/primitive",
  "@radix-ui/react-compose-refs",
  "@radix-ui/react-context",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dismissable-layer",
  "@radix-ui/react-focus-guards",
  "@radix-ui/react-focus-scope",
  "@radix-ui/react-id",
  "@radix-ui/react-portal",
  "@radix-ui/react-presence",
  "@radix-ui/react-primitive",
  "@radix-ui/react-slot",
  "@radix-ui/react-use-callback-ref",
  "@radix-ui/react-use-controllable-state",
  "@radix-ui/react-use-effect-event",
  "@radix-ui/react-use-layout-effect",
  "@tanstack/query-core",
  "@tanstack/query-persist-client-core",
  "@tanstack/react-query",
  "@webext-core/messaging",
  "@wxt-dev/browser",
  "aria-hidden",
  "arweave",
  "bignumber.js",
  "class-variance-authority",
  "clsx",
  "flag-icons",
  "get-nonce",
  "lucide-react",
  "qr-code-styling",
  "react",
  "react-dom",
  "react-remove-scroll",
  "react-remove-scroll-bar",
  "react-style-singleton",
  "scheduler",
  "tailwind-merge",
  "tslib",
  "use-callback-ref",
  "use-sidecar",
  "vaul",
  "vite-plugin-node-polyfills",
  "wxt",
  "zod",
];

/**
 * What the Keystone panel adds: its QR and UR libraries and the Node
 * polyfills they pull in. The approval page loads it lazily; the connect
 * page loads it up front.
 */
const KEYSTONE_PANEL_PACKAGES = [
  "@keystonehq/alias-sampling",
  "@keystonehq/bc-ur-registry",
  "@keystonehq/bc-ur-registry-arweave",
  "@ngraveio/bc-ur",
  "assert",
  "available-typed-arrays",
  "base-x",
  "base64-js",
  "bs58",
  "bs58check",
  "buffer",
  "call-bind",
  "call-bind-apply-helpers",
  "call-bound",
  "cbor-sync",
  "cipher-base",
  "core-util-is",
  "crc",
  "create-hash",
  "define-data-property",
  "define-properties",
  "dunder-proto",
  "es-define-property",
  "es-errors",
  "es-object-atoms",
  "events",
  "for-each",
  "generator-function",
  "get-intrinsic",
  "get-proto",
  "gopd",
  "has-property-descriptors",
  "has-symbols",
  "has-tostringtag",
  "hash-base",
  "hasown",
  "ieee754",
  "inherits",
  "is-arguments",
  "is-callable",
  "is-generator-function",
  "is-nan",
  "is-regex",
  "is-typed-array",
  "isarray",
  "jsbi",
  "jsqr",
  "math-intrinsics",
  "md5.js",
  "object-is",
  "object-keys",
  "object.assign",
  "possible-typed-array-names",
  "process-nextick-args",
  "qrcode-generator",
  "readable-stream",
  "ripemd160",
  "safe-buffer",
  "safe-regex-test",
  "set-function-length",
  "sha.js",
  "stream-browserify",
  "string_decoder",
  "to-buffer",
  "typed-array-buffer",
  "util",
  "util-deprecate",
  "uuid",
  "which-typed-array",
];

const CONNECT_PACKAGES = [
  "@aklinker1/zero-serialize-error",
  "@radix-ui/react-compose-refs",
  "@radix-ui/react-slot",
  "@webext-core/messaging",
  "@wxt-dev/browser",
  "arweave",
  "bignumber.js",
  "class-variance-authority",
  "clsx",
  "react",
  "react-dom",
  "scheduler",
  "tailwind-merge",
  "tslib",
  "vite-plugin-node-polyfills",
  "wxt",
  "zod",
];

/** @type {Record<string, string[]>} */
export const BUNDLE_PACKAGES = {
  "background.js": [
    "@aklinker1/zero-serialize-error",
    "@webext-core/messaging",
    "@wxt-dev/browser",
    "@wxt-dev/storage",
    "arweave",
    "bignumber.js",
    "hash-wasm",
    "superlock",
    "vite-plugin-node-polyfills",
    "wxt",
    "zod",
  ],
  "approval.html": [
    "@aklinker1/zero-serialize-error",
    "@dicebear/core",
    "@dicebear/styles",
    "@radix-ui/primitive",
    "@radix-ui/react-compose-refs",
    "@radix-ui/react-context",
    "@radix-ui/react-dialog",
    "@radix-ui/react-dismissable-layer",
    "@radix-ui/react-focus-guards",
    "@radix-ui/react-focus-scope",
    "@radix-ui/react-id",
    "@radix-ui/react-portal",
    "@radix-ui/react-presence",
    "@radix-ui/react-primitive",
    "@radix-ui/react-slot",
    "@radix-ui/react-use-callback-ref",
    "@radix-ui/react-use-controllable-state",
    "@radix-ui/react-use-effect-event",
    "@radix-ui/react-use-layout-effect",
    "@tanstack/query-core",
    "@tanstack/react-query",
    "@webext-core/messaging",
    "@wxt-dev/browser",
    "aria-hidden",
    "arweave",
    "bignumber.js",
    "class-variance-authority",
    "clsx",
    "get-nonce",
    "lucide-react",
    "qr-code-styling",
    "react",
    "react-dom",
    "react-remove-scroll",
    "react-remove-scroll-bar",
    "react-style-singleton",
    "scheduler",
    "tailwind-merge",
    "tslib",
    "use-callback-ref",
    "use-sidecar",
    "vaul",
    "vite-plugin-node-polyfills",
    "wxt",
    "zod",
  ],
  "connect.html": [...CONNECT_PACKAGES, ...KEYSTONE_PANEL_PACKAGES].sort(),
  "passkey.html": [
    "@aklinker1/zero-serialize-error",
    "@dicebear/core",
    "@dicebear/styles",
    "@radix-ui/react-compose-refs",
    "@radix-ui/react-slot",
    "@webext-core/messaging",
    "@wxt-dev/browser",
    "arweave",
    "bignumber.js",
    "class-variance-authority",
    "clsx",
    "react",
    "react-dom",
    "scheduler",
    "tailwind-merge",
    "vite-plugin-node-polyfills",
    "wxt",
    "zod",
  ],
  "popup.html": POPUP_PACKAGES,
  "sidepanel.html": POPUP_PACKAGES,
};

/**
 * Chunks an entry loads only through a dynamic `import()`, each named by a
 * module it holds, with the npm packages it adds beyond what the entry
 * loads up front. The entry's own list in BUNDLE_PACKAGES covers only that
 * eager part, so a lazy chunk that becomes eager fails the check.
 * @type {Record<string, Record<string, string[]>>}
 */
export const LAZY_PACKAGES = {
  "approval.html": {
    // The Keystone panel, loaded the first time a Keystone wallet signs.
    "apps/extension/src/hardware/panels/keystone.ts": KEYSTONE_PANEL_PACKAGES,
  },
};

/**
 * Built worker scripts, by file pattern (`*` matches the content hash
 * Vite appends). Each `new Worker()` entry lands in the bundle as an
 * asset, not a chunk, so `recordBundleModules` writes no module map for
 * it and the package checks above never see it; naming it here, with a
 * size budget, is what brings it under the gate. A pattern that matches
 * nothing fails the check too, so the list never holds more than the
 * bundle does.
 * @type {Record<string, { maxBytes: number }>}
 */
export const WORKER_SCRIPTS = {
  // The seed-phrase key derivation worker: node-forge's prime search.
  "assets/phrase-key.worker-*.js": { maxBytes: 400 * 1024 },
};
