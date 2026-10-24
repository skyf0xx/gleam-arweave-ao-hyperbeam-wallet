// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Root ESLint flat config (repo-wide lint plus the import-boundary rule
 * below; ESLint 9 reads flat config by default, not `.eslintrc.cjs`).
 *
 * The import-boundary rule enforces CLAUDE.md's hexagonal constraint:
 * `packages/core` never imports an adapter, and popup-side UI code never
 * imports background-adapter code directly — every cross-context call
 * crosses `packages/messaging`.
 */
// Any path into `packages/core/src/signer`: the `@gleam/core/signer`
// subpath, any path through `src/signer`, or `../signer` anywhere in a
// relative path (so `../ao/../signer` counts too). `vault/signer.ts` (the
// `Signer` interface) is `./signer` from inside `vault/` and stays
// importable. `dirTail` follows the folder name, so an override can let
// one file through.
const signerImport = (dirTail = "(/|$)") =>
  `^@gleam/core/signer(/|$)|(^|/)(\\.\\.|src)/signer${dirTail}|^\\./signer/`;
const SIGNER_IMPORT = signerImport();
const SIGNER_IMPORT_MESSAGE =
  "Only key-session.ts, wallet-lifecycle.ts and the keyring import core/signer. Sign through a `Signer` from `getSigner(walletId)`.";

// `no-restricted-imports` reads only static `import`/`export … from`, so
// this catches `import("…")` with a literal path against the same regex.
const noDynamicImport = {
  meta: {
    type: "problem",
    schema: { type: "array", items: { type: "object", properties: { regex: { type: "string" }, message: { type: "string" } } } },
  },
  create(context) {
    const fences = context.options.map(({ regex, message }) => ({ re: new RegExp(regex), message }));
    return {
      ImportExpression(node) {
        const src = node.source;
        const path =
          src.type === "Literal" && typeof src.value === "string"
            ? src.value
            : src.type === "TemplateLiteral" && src.expressions.length === 0
              ? src.quasis[0].value.cooked
              : null;
        if (path === null) return;
        for (const { re, message } of fences) {
          if (re.test(path)) context.report({ node, message: `'${path}' import is restricted. ${message}` });
        }
      },
    };
  },
};
const gleam = { rules: { "no-dynamic-import": noDynamicImport } };
const signerFence = (regex) => ({
  "no-restricted-imports": ["error", { patterns: [{ regex, message: SIGNER_IMPORT_MESSAGE }] }],
  "gleam/no-dynamic-import": ["error", { regex, message: SIGNER_IMPORT_MESSAGE }],
});

// `packages/runtime` runs in any shell (the extension's service worker, a
// mobile app), so it reaches a platform only through `Platform`. Block the
// shells' SDKs, both shells, their `@/` and `~/` aliases, and the extension
// globals. `(^|/)apps/` also catches a relative climb into `apps/`.
const RUNTIME_IMPORT = "^(wxt|@capacitor|@webext-core)(/|$)|(^|/)apps/(extension|mobile)(/|$)|^[@~]/";
const RUNTIME_IMPORT_MESSAGE =
  "packages/runtime is shell-free: no wxt, @capacitor, @webext-core or apps/*. Take what you need through `Platform`.";
const RUNTIME_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/runtime never touches extension globals. Add a port to `Platform` and let the shell implement it.",
}));
const runtimeFence = (...extraPatterns) => ({
  "no-restricted-imports": [
    "error",
    { patterns: [...extraPatterns, { regex: RUNTIME_IMPORT, message: RUNTIME_IMPORT_MESSAGE }] },
  ],
  "no-restricted-globals": ["error", ...RUNTIME_GLOBALS],
});

// `packages/app` is every screen, and any shell mounts it, so like the
// runtime it reaches a platform only through `AppPlatform`. The same SDKs,
// shells, aliases and globals are blocked.
const APP_IMPORT_MESSAGE =
  "packages/app is shell-free: no wxt, @capacitor, @webext-core or apps/*. Take what you need through `AppPlatform`.";
const APP_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/app never touches extension globals. Add a port to `AppPlatform` and let the shell implement it.",
}));

// Flat config replaces a rule's options wholesale when a later block sets
// the same rule, so every block that sets `no-restricted-syntax` spreads
// in the full list it needs rather than adding to an earlier block's.
//
// Wallet pages hold unlocked keys, so markup is never parsed into their
// DOM: render images through <img> and text through React.
const NO_HTML_INJECTION = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: "Don't inject HTML. Render SVG through an <img> data URI and text through React.",
  },
  {
    selector:
      "AssignmentExpression[left.property.name=/^(inner|outer)HTML$/]:not([right.type='Literal'][right.value=''])",
    message: "Don't assign HTML. Build nodes with textContent or createElement instead.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment)$/]",
    message: "Don't parse HTML into the page. Build nodes with textContent or createElement instead.",
  },
];
const NO_RAW_KEY = [
  {
    selector: "Identifier[name='JWKInterface']",
    message:
      "Raw key material stays in key-session.ts and core/signer. Take a `Signer` (or the `owner` string for public-key work) instead.",
  },
  {
    selector: "Identifier[name='getCachedKey']",
    message: "Use `getSigner(walletId)` from key-session.ts; the raw cached key never leaves that module.",
  },
];
const NO_DYNAMIC_SIGNER_IMPORT = [
  {
    selector: "CallExpression[callee.name='require'], ImportExpression",
    message: "core/signer uses static imports only, so the import fence above can check them.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/node_modules/**",
      "**/.claude/worktrees/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
      "react-hooks": reactHooks,
      gleam,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-syntax": ["error", ...NO_HTML_INJECTION],
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/core/src",
              from: "./apps/extension/src/adapters",
              message:
                "packages/core must not import an adapter directly — adapters are wired at the extension's entrypoints, per core-design.md's ports/adapters split.",
            },
          ],
        },
      ],
    },
  },
  {
    // Only the key session and the vault/unlock path handle raw key
    // material; everything else signs through an opaque `Signer`, so the
    // cached key can become a non-extractable CryptoKey without touching
    // callers. CI lints the whole repo, so a new leak fails there.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "packages/runtime/src/handlers/key-session.ts",
      // Caches the key on unlock/import/create, and decrypts it for export.
      "packages/runtime/src/handlers/wallet-lifecycle.ts",
      "packages/core/src/signer/**",
      // Validates and addresses keyfiles.
      "packages/core/src/keys/jwk.ts",
      // Where `JWKInterface` is defined and re-exported.
      "packages/core/src/models/wallet.ts",
      "packages/core/src/models/index.ts",
      // `importWallet`/`exportWallet` carry a keyfile across the wire by design.
      "packages/messaging/src/protocol.ts",
      // Unlock hands the key to the keyring offscreen document, once.
      "packages/core/src/ports/session-keys.ts",
      "packages/messaging/src/keyring-protocol.ts",
      "apps/extension/src/adapters/offscreen-keyring.ts",
      // Conformance suites import throwaway keys into a `SessionKeyStorePort`.
      "packages/runtime/testing/**",
      // Receives the exported keyfile to hand to the user.
      "packages/app/src/screens/wallet-detail/src/WalletDetailView.tsx",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...NO_HTML_INJECTION, ...NO_RAW_KEY],
    },
  },
  {
    // `core/signer` holds the vault envelope and the unlocked key. Only the
    // key session, the unlock path and the keyring reach it, so a compromised
    // UI dependency or handler has no import path to the key.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "packages/core/src/signer/**",
      "packages/runtime/src/handlers/key-session.ts",
      "packages/runtime/src/handlers/wallet-lifecycle.ts",
      "apps/extension/src/keyring/server.ts",
      "apps/extension/src/adapters/offscreen-keyring.ts",
      "apps/extension/entrypoints/keyring/main.ts",
      // Points API test fixtures sign with throwaway keys.
      "apps/points-api/src/test-signers.ts",
      // Gives tests the in-memory `Keyring` in place of the offscreen one.
      "vitest.setup.ts",
      "packages/runtime/testing/**",
      "apps/extension/src/adapters/offscreen-keyring.testing.ts",
    ],
    rules: signerFence(SIGNER_IMPORT),
  },
  {
    // The runtime fence, signer fence included for the files the one above
    // covers: a later block replaces a rule's options wholesale, so the
    // signer pattern is repeated here, and the key session and lifecycle
    // handler (which may import the signer) get the runtime fence alone.
    files: ["packages/runtime/**/*.{ts,tsx}"],
    rules: {
      ...runtimeFence(),
      "gleam/no-dynamic-import": ["error", { regex: RUNTIME_IMPORT, message: RUNTIME_IMPORT_MESSAGE }],
    },
  },
  {
    files: ["packages/runtime/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "packages/runtime/testing/**",
      "packages/runtime/src/handlers/key-session.ts",
      "packages/runtime/src/handlers/wallet-lifecycle.ts",
    ],
    rules: {
      ...runtimeFence({ regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE }),
      "gleam/no-dynamic-import": [
        "error",
        { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
        { regex: RUNTIME_IMPORT, message: RUNTIME_IMPORT_MESSAGE },
      ],
    },
  },
  {
    // The app fence. A later block replaces a rule's options wholesale, so
    // the second block repeats it with the signer fence for non-test files.
    files: ["packages/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ regex: RUNTIME_IMPORT, message: APP_IMPORT_MESSAGE }] }],
      "no-restricted-globals": ["error", ...APP_GLOBALS],
      "gleam/no-dynamic-import": ["error", { regex: RUNTIME_IMPORT, message: APP_IMPORT_MESSAGE }],
    },
  },
  {
    files: ["packages/app/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
            { regex: RUNTIME_IMPORT, message: APP_IMPORT_MESSAGE },
          ],
        },
      ],
      "gleam/no-dynamic-import": [
        "error",
        { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
        { regex: RUNTIME_IMPORT, message: APP_IMPORT_MESSAGE },
      ],
    },
  },
  {
    // From the top of `core/src`, `./signer` is the signer folder itself.
    // `@gleam/core` (`index.ts`) is imported everywhere, so it can't
    // re-export the signer either.
    files: ["packages/core/src/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: signerFence(`${SIGNER_IMPORT}|^\\./signer$`),
  },
  {
    // Wipes the passkey's PRF output, and may take nothing else from the signer.
    files: ["packages/core/src/vault/passkey.ts"],
    rules: signerFence(signerImport("(?!/zeroize$)")),
  },
  {
    // Key code can't pull in a dependency: one compromised package here
    // would sit next to the decrypted key. Argon2id (`hash-wasm`) is the
    // one exception, and relative imports may only reach types and the
    // byte helpers.
    files: ["packages/core/src/signer/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "^(?!hash-wasm$|\\./[^/]+$|\\.\\./models/[^/]+$|\\.\\./ports/[^/]+$|\\.\\./vault/(base64|signer|message-signing)$)",
              message:
                "core/signer imports only hash-wasm, its own files, models, ports and vault/{base64,signer,message-signing}.",
            },
          ],
        },
      ],
      // The import rule reads only static `import`/`export … from`.
      "no-restricted-syntax": ["error", ...NO_HTML_INJECTION, ...NO_DYNAMIC_SIGNER_IMPORT],
    },
  },
  {
    // The static site's vanilla script runs in the browser; `globals` isn't
    // resolvable from the root, so the handful it uses are listed here.
    files: ["apps/site/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        IntersectionObserver: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        location: "readonly",
        navigator: "readonly",
        sessionStorage: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
      },
    },
  },
);
