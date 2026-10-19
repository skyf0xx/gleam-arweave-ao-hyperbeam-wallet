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
  meta: { type: "problem", schema: [{ type: "object", properties: { regex: { type: "string" }, message: { type: "string" } } }] },
  create(context) {
    const { regex, message } = context.options[0] ?? {};
    if (!regex) return {};
    const re = new RegExp(regex);
    return {
      ImportExpression(node) {
        const src = node.source;
        const path =
          src.type === "Literal" && typeof src.value === "string"
            ? src.value
            : src.type === "TemplateLiteral" && src.expressions.length === 0
              ? src.quasis[0].value.cooked
              : null;
        if (path !== null && re.test(path)) context.report({ node, message: `'${path}' import is restricted. ${message}` });
      },
    };
  },
};
const gleam = { rules: { "no-dynamic-import": noDynamicImport } };
const signerFence = (regex) => ({
  "no-restricted-imports": ["error", { patterns: [{ regex, message: SIGNER_IMPORT_MESSAGE }] }],
  "gleam/no-dynamic-import": ["error", { regex, message: SIGNER_IMPORT_MESSAGE }],
});

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
      "packages/core/src/signer/**",
      // Generates, validates and addresses keyfiles.
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
      // Receives the exported keyfile to hand to the user.
      "apps/extension/entrypoints/popup/wallet-detail/src/WalletDetailView.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name='JWKInterface']",
          message:
            "Raw key material stays in key-session.ts and core/signer. Take a `Signer` (or the `owner` string for public-key work) instead.",
        },
        {
          selector: "Identifier[name='getCachedKey']",
          message: "Use `getSigner(walletId)` from key-session.ts; the raw cached key never leaves that module.",
        },
      ],
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
      "apps/extension/src/handlers/key-session.ts",
      "apps/extension/src/handlers/wallet-lifecycle.ts",
      "apps/extension/src/keyring/server.ts",
      "apps/extension/src/adapters/offscreen-keyring.ts",
      "apps/extension/entrypoints/keyring/main.ts",
      // Points API test fixtures sign with throwaway keys.
      "apps/points-api/src/test-signers.ts",
      // Gives tests the in-memory `Keyring` in place of the offscreen one.
      "vitest.setup.ts",
    ],
    rules: signerFence(SIGNER_IMPORT),
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
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='require'], ImportExpression",
          message: "core/signer uses static imports only, so the import fence above can check them.",
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
