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
 *
 * The fences below match specifier strings and give editor feedback.
 * `.dependency-cruiser.cjs` (`pnpm deps:check`) checks the same fences on
 * resolved files, which also catches relative climbs and re-exports.
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
  "Only key-session.ts, wallet-lifecycle.ts, backup.ts and the keyring import core/signer. Sign through a `Signer` from `getSigner(walletId)`.";

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
// A `storage.set(K, …)` in a file that also reads `storage.get(K)` is a
// read-modify-write, whichever function does the read: another write to K
// between the two is lost. Such a write goes through `updateStored`
// (`runtime/src/storage-update.ts`), which runs one update per key at a
// time. A key is named by its constant: `${PREFIX}${id}` by PREFIX,
// `keyFor(id)` by keyFor, and a local `const key = …` by what it holds. A
// read through a helper's parameter (`load(key)`) reads every key, and a
// write through one writes every key. A whole-value write that doesn't
// depend on the read takes an eslint-disable with the reason.
const noStorageReadModifyWrite = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const source = context.sourceCode;
    const gets = [];
    const sets = [];
    const isStorage = (node) => {
      const name = node.type === "MemberExpression" ? node.property.name : node.type === "Identifier" ? node.name : null;
      return typeof name === "string" && /storage$/i.test(name);
    };
    const ANY = "*";
    const keyOf = (node, seen = new Set()) => {
      if (node.type === "TemplateLiteral") {
        const first = node.expressions[0];
        return first && node.quasis[0].value.raw === "" ? keyOf(first, seen) : source.getText(node);
      }
      if (node.type === "CallExpression") return source.getText(node.callee);
      if (node.type === "Identifier") {
        if (/^[A-Z][A-Z0-9_]*$/.test(node.name) || seen.has(node.name)) return node.name;
        seen.add(node.name);
        let scope = source.getScope(node);
        while (scope) {
          const variable = scope.set.get(node.name);
          if (variable) {
            const def = variable.defs[0];
            if (def?.type === "Parameter") return ANY;
            if (def?.type === "Variable" && def.node.init) return keyOf(def.node.init, seen);
            return node.name;
          }
          scope = scope.upper;
        }
        return node.name;
      }
      return source.getText(node);
    };
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
        if (!isStorage(callee.object) || node.arguments.length === 0) return;
        if (callee.property.name === "get") gets.push(keyOf(node.arguments[0]));
        else if (callee.property.name === "set") sets.push({ key: keyOf(node.arguments[0]), node });
      },
      "Program:exit"() {
        for (const set of sets) {
          if (gets.includes(set.key) || gets.includes(ANY) || (set.key === ANY && gets.length > 0)) {
            context.report({
              node: set.node,
              message: `${set.key} is written in a file that reads it. Use updateStored (runtime/src/storage-update.ts), which runs one update per key at a time.`,
            });
          }
        }
      },
    };
  },
};
// `.dependency-cruiser.cjs` checks the fences on resolved files, and a
// computed `import()` path can't be resolved, so it would pass unseen.
const noComputedImport = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      ImportExpression(node) {
        const src = node.source;
        const literal = src.type === "Literal" || (src.type === "TemplateLiteral" && src.expressions.length === 0);
        if (!literal) {
          context.report({ node, message: "import() takes a literal path, so the import fences can check it." });
        }
      },
    };
  },
};
// DESIGN.md's type scale is a set of tokens; a raw `text-[13px]` in a class
// string is a size outside it.
const RAW_TEXT_SIZE = /(^|[\s:"'`])text-\[\d+(\.\d+)?(px|rem|em)\]/;
const typeScale = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const check = (node, text) => {
      if (RAW_TEXT_SIZE.test(text)) {
        context.report({ node, message: "Use a DESIGN.md type-scale token (text-caption … text-display-lg, text-micro), not a raw size." });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, ` ${node.value}`);
      },
      TemplateElement(node) {
        check(node, ` ${node.value.cooked ?? ""}`);
      },
    };
  },
};
// Strings from a site, a token process, a tag or a device render through
// `<UntrustedText>` (bidi controls, zero-width characters), never as bare
// JSX text. Checks JSX children only; an attribute value is a prop for
// something else to render. The user's own labels are named in OWN_LABELS.
const UNTRUSTED_ALWAYS = new Set(["ticker", "tokenTicker", "decodedData"]);
const UNTRUSTED_ON_TAG = new Set(["name", "value", "walletName"]);
const UNTRUSTED_PATHS = new Set(["appInfo.name", "summary.text"]);
const OWN_LABELS = new Set(["wallet", "from", "contact"]);
const untrustedText = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const nameOf = (node) =>
      node.type === "Identifier" ? node.name : node.type === "MemberExpression" && !node.computed ? node.property.name : null;
    const untrusted = (expr) => {
      const node = expr.type === "ChainExpression" ? expr.expression : expr;
      if (node.type !== "MemberExpression" || node.computed || node.property.type !== "Identifier") return false;
      const prop = node.property.name;
      const object = nameOf(node.object);
      if (object === null || OWN_LABELS.has(object)) return false;
      if (UNTRUSTED_PATHS.has(`${object}.${prop}`)) return true;
      if (UNTRUSTED_ALWAYS.has(prop)) return true;
      return UNTRUSTED_ON_TAG.has(prop) && /tag/i.test(object);
    };
    return {
      JSXExpressionContainer(node) {
        if (node.parent.type !== "JSXElement" && node.parent.type !== "JSXFragment") return;
        if (node.expression.type === "JSXEmptyExpression" || !untrusted(node.expression)) return;
        const wrapped = context.sourceCode
          .getAncestors(node)
          .some((a) => a.type === "JSXElement" && a.openingElement.name.type === "JSXIdentifier" && a.openingElement.name.name === "UntrustedText");
        if (wrapped) return;
        context.report({
          node,
          message: `${context.sourceCode.getText(node.expression)} comes from a site, token or tag. Render it through <UntrustedText>, never as bare JSX text.`,
        });
      },
    };
  },
};
const gleam = {
  rules: {
    "untrusted-text": untrustedText,
    "type-scale": typeScale,
    "no-dynamic-import": noDynamicImport,
    "no-computed-import": noComputedImport,
    "no-storage-read-modify-write": noStorageReadModifyWrite,
  },
};
// `no-restricted-globals` sees a bare `chrome`, not `globalThis.chrome`.
const NO_GLOBAL_OBJECT_EXTENSION_API = ["globalThis", "self", "window"].flatMap((object) =>
  ["chrome", "browser"].map((property) => ({
    object,
    property,
    message: "Shell-free packages never touch extension globals. Reach the platform through a port.",
  })),
);
const signerFence = (regex) => ({
  "no-restricted-imports": ["error", { patterns: [{ regex, message: SIGNER_IMPORT_MESSAGE }] }],
  "gleam/no-dynamic-import": ["error", { regex, message: SIGNER_IMPORT_MESSAGE }],
});

// `packages/runtime` runs in any shell (the extension's service worker, a
// mobile app), so it reaches a platform only through `Platform`. Block the
// shells' SDKs, both shells, their `@/` and `~/` aliases, and the extension
// globals. `(^|/)apps/` also catches a relative climb into `apps/`.
const RUNTIME_IMPORT = "^(wxt|@capacitor|@capacitor-community|@capgo|@webext-core)(/|$)|(^|/)apps/(extension|mobile)(/|$)|^[@~]/";
const RUNTIME_IMPORT_MESSAGE =
  "packages/runtime is shell-free: no wxt, Capacitor plugins, @webext-core or apps/*. Take what you need through `Platform`.";
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
  "packages/app is shell-free: no wxt, Capacitor plugins, @webext-core or apps/*. Take what you need through `AppPlatform`.";
// The hardware-wallet libraries belong to a shell's signing panels, which
// it hands the app through `AppPlatform.hardwareWallets`. Imported from
// `packages/app`, they would land in the popup and the phone bundle.
const HARDWARE_IMPORT = "^@(keystonehq|ngraveio|ledgerhq)(/|$)";
const HARDWARE_IMPORT_MESSAGE =
  "packages/app doesn't import hardware-wallet libraries. The shell provides its signing panels through `AppPlatform.hardwareWallets`.";
const APP_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/app never touches extension globals. Add a port to `AppPlatform` and let the shell implement it.",
}));
const KEYSTONE_IMPORT_MESSAGE =
  "packages/keystone is shared by both shells: no wxt, Capacitor plugins, @webext-core or apps/*. Take shell-specific copy or behaviour as props.";
const KEYSTONE_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/keystone never touches extension globals. Take what differs per shell as props.",
}));

// `packages/provider` runs in the page's own world, where anything it
// loads is reachable by the page, and any shell injects it. Beyond the
// shell fence, it takes no wallet logic: nothing from core, runtime, app
// or ui, and from messaging only the page wire contract. A relative climb
// out of the package counts too.
const PROVIDER_IMPORT =
  "^@gleam/(core|runtime|app|ui)(/|$)|(^|/)packages/(core|runtime|app|ui|messaging)(/|$)|^(\\.\\./){2,}(core|runtime|app|ui|messaging)(/|$)|^@gleam/messaging(?!/src/page-protocol(\\.ts)?$)";
const PROVIDER_IMPORT_MESSAGE =
  "packages/provider is page-world code: no wxt, Capacitor plugins, @webext-core, shell apps, or @gleam/core/runtime/app/ui, and only page-protocol from @gleam/messaging. Reach the wallet through `ProviderTransport`.";
const PROVIDER_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/provider never touches extension globals. Reach the wallet through `ProviderTransport`.",
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
// An error text a person can reach is translated at display, so a handler
// names its code (`userErrorMessage`) or marks the English as deliberate
// (`dappError`); a bare literal would reach a zh-CN popup untranslated.
const NO_LITERAL_ERROR_THROW = [
  {
    selector:
      "ThrowStatement > NewExpression[callee.name='Error'] > :matches(Literal[value=/./], TemplateLiteral).arguments:first-child",
    message:
      "Throw `new Error(userErrorMessage(code))` for text a person can reach, or `new Error(dappError(...))` for English by design.",
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
      ".stryker-tmp/**",
      "reports/**",
      // Generated native projects; `cap sync` copies the built bundle into them.
      "apps/mobile/ios/**",
      "apps/mobile/android/**",
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
);
