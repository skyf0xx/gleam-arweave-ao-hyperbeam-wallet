// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import { gleam } from "./eslint-rules/index.js";
import { FILE_SIZE_CAPS, MAX_LINES } from "./scripts/file-size-caps.mjs";

/**
 * Root ESLint flat config (repo-wide lint plus the import-boundary rule
 * below; ESLint 9 reads flat config by default, not `.eslintrc.cjs`).
 *
 * The import-boundary rule enforces CLAUDE.md's hexagonal constraint:
 * `packages/core` never imports an adapter, and popup-side UI code never
 * imports background-adapter code directly — every cross-context call
 * crosses `packages/messaging`.
 *
 * The fences below match specifier strings and give editor feedback.
 * `.dependency-cruiser.cjs` (`pnpm deps:check`) checks the same fences on
 * resolved files, which also catches relative climbs and re-exports.
 */
import {
  signerImport,
  SIGNER_IMPORT,
  SIGNER_IMPORT_MESSAGE,
  NO_GLOBAL_OBJECT_EXTENSION_API,
  signerFence,
  RUNTIME_IMPORT,
  RUNTIME_IMPORT_MESSAGE,
  runtimeFence,
  APP_IMPORT_MESSAGE,
  HARDWARE_IMPORT,
  HARDWARE_IMPORT_MESSAGE,
  APP_GLOBALS,
  KEYSTONE_IMPORT_MESSAGE,
  KEYSTONE_GLOBALS,
  PROVIDER_IMPORT,
  PROVIDER_IMPORT_MESSAGE,
  PROVIDER_GLOBALS,
  NO_HTML_INJECTION,
  NO_RAW_KEY,
  NO_LITERAL_ERROR_THROW,
  NO_DYNAMIC_SIGNER_IMPORT,
  maxLines,
} from "./eslint-rules/fences.js";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/node_modules/**",
      "**/.claude/worktrees/**",
      ".stryker-tmp/**",
      ".gleam-scan/**",
      "reports/**",
      // Generated native projects; `cap sync` copies the built bundle into them.
      "apps/mobile/ios/**",
      "apps/mobile/android/**",
      // Umami's minified tracker, copied as-is.
      "apps/site/umami.js",
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
      // Derives a keyfile from a recovery phrase for import.
      "packages/core/src/keys/mnemonic-jwk.ts",
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
      // Wraps and unwraps the vault backup's key under the password.
      "packages/runtime/src/handlers/backup.ts",
      "apps/extension/src/keyring/server.ts",
      "apps/extension/src/adapters/offscreen-keyring.ts",
      "apps/extension/entrypoints/keyring/main.ts",
      "apps/mobile/src/adapters/session-key-store.ts",
      // Points API test fixtures sign with throwaway keys.
      "apps/points-api/src/testing/test-signers.ts",
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
      "packages/runtime/src/handlers/backup.ts",
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
    files: ["packages/**/*.{ts,tsx}", "apps/extension/**/*.{ts,tsx}", "apps/mobile/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "gleam/no-computed-import": "error" },
  },
  {
    files: ["packages/{app,ui,keystone}/**/*.tsx", "apps/{extension,mobile}/**/*.tsx"],
    ignores: ["**/*.test.tsx"],
    rules: { "gleam/type-scale": "error" },
  },
  {
    files: ["packages/app/src/{approval,transfer-review}/**/*.tsx"],
    ignores: ["**/*.test.tsx"],
    rules: { "gleam/untrusted-text": "error" },
  },
  {
    // The same fence as `no-restricted-globals` below, through a global object.
    files: ["packages/**/*.{ts,tsx}"],
    rules: { "no-restricted-properties": ["error", ...NO_GLOBAL_OBJECT_EXTENSION_API] },
  },
  {
    // core, messaging and ui run in every shell and context, like runtime.
    files: ["packages/{core,messaging,ui}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["chrome", "browser"].map((name) => ({
          name,
          message: "Shell-free packages never touch extension globals. Reach the platform through a port.",
        })),
      ],
    },
  },
  {
    files: ["packages/runtime/src/**/*.ts"],
    // storage-update.ts is the one place a key is read and written, one
    // update per key at a time. The other two write under withSessionLock,
    // and key-session.ts overwrites an entry only to zeroize it.
    ignores: [
      "**/*.test.ts",
      "packages/runtime/src/storage-update.ts",
      "packages/runtime/src/handlers/wallet-lifecycle.ts",
      "packages/runtime/src/handlers/key-session.ts",
    ],
    rules: { "gleam/no-storage-read-modify-write": "error" },
  },
  {
    // Later than the two blocks that set `no-restricted-syntax` for all
    // files, so it repeats their lists; key-session and wallet-lifecycle
    // are the ones the raw-key list skips.
    files: ["packages/runtime/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/runtime/src/handlers/key-session.ts", "packages/runtime/src/handlers/wallet-lifecycle.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_HTML_INJECTION, ...NO_RAW_KEY, ...NO_LITERAL_ERROR_THROW] },
  },
  {
    files: [
      "packages/runtime/src/handlers/key-session.ts",
      "packages/runtime/src/handlers/wallet-lifecycle.ts",
    ],
    rules: { "no-restricted-syntax": ["error", ...NO_HTML_INJECTION, ...NO_LITERAL_ERROR_THROW] },
  },
  {
    // The app fence. A later block replaces a rule's options wholesale, so
    // the second block repeats it with the signer fence for non-test files.
    files: ["packages/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: RUNTIME_IMPORT, message: APP_IMPORT_MESSAGE },
            { regex: HARDWARE_IMPORT, message: HARDWARE_IMPORT_MESSAGE },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...APP_GLOBALS],
      "gleam/no-dynamic-import": [
        "error",
        { regex: RUNTIME_IMPORT, message: APP_IMPORT_MESSAGE },
        { regex: HARDWARE_IMPORT, message: HARDWARE_IMPORT_MESSAGE },
      ],
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
            { regex: HARDWARE_IMPORT, message: HARDWARE_IMPORT_MESSAGE },
          ],
        },
      ],
      "gleam/no-dynamic-import": [
        "error",
        { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
        { regex: RUNTIME_IMPORT, message: APP_IMPORT_MESSAGE },
        { regex: HARDWARE_IMPORT, message: HARDWARE_IMPORT_MESSAGE },
      ],
    },
  },
  {
    // `packages/keystone` is shared by both shells, so it gets the app's
    // shell fence, signer fence included. It is where the Keystone
    // libraries the app refuses live, so those stay allowed.
    files: ["packages/keystone/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
            { regex: RUNTIME_IMPORT, message: KEYSTONE_IMPORT_MESSAGE },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...KEYSTONE_GLOBALS],
      "gleam/no-dynamic-import": [
        "error",
        { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
        { regex: RUNTIME_IMPORT, message: KEYSTONE_IMPORT_MESSAGE },
      ],
    },
  },
  {
    // The provider fence, signer fence included: a later block replaces a
    // rule's options wholesale.
    files: ["packages/provider/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
            { regex: RUNTIME_IMPORT, message: PROVIDER_IMPORT_MESSAGE },
            { regex: PROVIDER_IMPORT, message: PROVIDER_IMPORT_MESSAGE },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...PROVIDER_GLOBALS],
      "gleam/no-dynamic-import": [
        "error",
        { regex: SIGNER_IMPORT, message: SIGNER_IMPORT_MESSAGE },
        { regex: RUNTIME_IMPORT, message: PROVIDER_IMPORT_MESSAGE },
        { regex: PROVIDER_IMPORT, message: PROVIDER_IMPORT_MESSAGE },
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
    files: ["apps/site/**/*.js", "apps/site-open/**/*.js"],
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
  {
    // One reason to change per file. Tests, catalogs and fixtures are one thing however long they grow.
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["**/*.test.{ts,tsx}", "**/i18n/messages/**", "**/*.fixtures.ts", "**/testing/**"],
    rules: { "max-lines": maxLines(MAX_LINES) },
  },
  ...Object.entries(FILE_SIZE_CAPS).map(([file, max]) => ({ files: [file], rules: { "max-lines": maxLines(max) } })),
);
