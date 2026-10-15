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
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Wallet pages hold unlocked keys, so markup is never parsed into
      // their DOM: render images through <img> and text through React.
      "no-restricted-syntax": [
        "error",
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
      ],
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
      "apps/extension/src/handlers/key-session.ts",
      // Caches the key on unlock/import/create, and decrypts it for export.
      "apps/extension/src/handlers/wallet-lifecycle.ts",
      "packages/core/src/vault/**",
      "packages/core/src/keys/**",
      // Where `JWKInterface` is defined and re-exported.
      "packages/core/src/models/wallet.ts",
      "packages/core/src/models/index.ts",
      // `importWallet`/`exportWallet` carry a keyfile across the wire by design.
      "packages/messaging/src/protocol.ts",
      // Receives the exported keyfile to hand to the user.
      "apps/extension/entrypoints/popup/wallet-detail/src/WalletDetailView.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name='JWKInterface']",
          message:
            "Raw key material stays in key-session.ts and the vault. Take a `Signer` (or the `owner` string for public-key work) instead.",
        },
        {
          selector: "Identifier[name='getCachedKey']",
          message: "Use `getSigner(walletId)` from key-session.ts; the raw cached key never leaves that module.",
        },
      ],
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
