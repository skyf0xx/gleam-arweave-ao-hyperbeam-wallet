// @ts-check
/* global module, __dirname */
/**
 * The package fences, checked on resolved files. ESLint's import rules
 * read specifier strings, so a relative climb (`../../runtime/src/…`), a
 * re-export or a type-only path walks past them; here every import is
 * resolved to the file it loads first. Run with `pnpm deps:check`
 * (lefthook and CI).
 */

const SHELL_SDKS = "node_modules/(wxt|@wxt-dev|@capacitor|@capacitor-community|@capgo|@webext-core)/";
const HARDWARE_LIBS = "node_modules/(@keystonehq|@ngraveio|@ledgerhq)/";

/** The files that may import `core/src/signer`: the key session, the unlock path and the keyring. */
const SIGNER_IMPORTERS = [
  "^packages/core/src/signer/",
  "^packages/runtime/src/handlers/key-session\\.ts$",
  "^packages/runtime/src/handlers/wallet-lifecycle\\.ts$",
  // Wraps and unwraps the vault backup's key under the password.
  "^packages/runtime/src/handlers/backup\\.ts$",
  "^apps/extension/src/keyring/server\\.ts$",
  "^apps/extension/src/adapters/offscreen-keyring\\.ts$",
  "^apps/extension/entrypoints/keyring/main\\.ts$",
  "^apps/mobile/src/adapters/session-key-store\\.ts$",
  // Gives tests the in-memory Keyring in place of the offscreen one.
  "^packages/runtime/testing/",
  // Points API test fixtures sign with throwaway keys.
  "^apps/points-api/src/test-signers\\.ts$",
];

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "resolvable",
      comment:
        "Every import resolves from the importing package. A package that isn't a dependency (e.g. @gleam/runtime from packages/app) or a shell SDK outside its shell doesn't, and the fences below can't check what they can't resolve.",
      severity: "error",
      from: { path: "^(packages|apps)/" },
      // Vite virtual modules exist only at build time.
      to: { couldNotResolve: true, pathNot: "^virtual:" },
    },
    {
      name: "core-is-shell-free",
      comment: "packages/core is pure domain logic: no other Gleam package, shell, shell SDK or adapter.",
      severity: "error",
      from: { path: "^packages/core/src/" },
      to: { path: [`^packages/(?!core/)`, "^apps/", SHELL_SDKS] },
    },
    {
      name: "messaging-is-contracts-only",
      comment: "packages/messaging holds wire contracts: it may import core and nothing above it.",
      severity: "error",
      from: { path: "^packages/messaging/src/" },
      to: { path: ["^packages/(runtime|app|ui|provider|keystone)/", "^apps/", SHELL_SDKS] },
    },
    {
      name: "ui-is-shell-free",
      comment: "packages/ui is design tokens and components: no runtime, app, provider, keystone, shell or shell SDK.",
      severity: "error",
      from: { path: "^packages/ui/src/" },
      to: { path: ["^packages/(runtime|app|provider|keystone)/", "^apps/", SHELL_SDKS] },
    },
    {
      name: "runtime-is-shell-free",
      comment: "packages/runtime reaches a platform only through Platform: no UI package, shell or shell SDK.",
      severity: "error",
      from: { path: "^packages/runtime/(src|testing)/" },
      to: { path: ["^packages/(app|ui|provider|keystone)/", "^apps/", SHELL_SDKS] },
    },
    {
      name: "app-is-shell-free",
      comment:
        "packages/app reaches a host only through AppPlatform: no runtime, keystone, provider, shell, shell SDK or hardware-wallet library.",
      severity: "error",
      from: { path: "^packages/app/src/" },
      to: { path: ["^packages/(runtime|provider|keystone)/", "^apps/", SHELL_SDKS, HARDWARE_LIBS] },
    },
    {
      name: "keystone-is-shell-free",
      comment:
        "packages/keystone is shared by both shells: no runtime, provider, shell or shell SDK. It renders inside the app, so it may use the app's i18n and device panels.",
      severity: "error",
      from: { path: "^packages/keystone/src/" },
      to: { path: ["^packages/(runtime|provider)/", "^apps/", SHELL_SDKS] },
    },
    {
      name: "provider-is-page-world",
      comment:
        "packages/provider runs in the page: it imports its own files and messaging's page-protocol.ts, nothing else.",
      severity: "error",
      from: { path: "^packages/provider/src/" },
      to: { pathNot: ["^packages/provider/src/", "^packages/messaging/src/page-protocol\\.ts$"] },
    },
    {
      name: "signer-imports-nothing",
      comment:
        "Key code can't pull in a dependency: core/signer imports hash-wasm, its own files, models, ports and vault/{base64,signer,message-signing}.",
      severity: "error",
      from: { path: "^packages/core/src/signer/" },
      to: {
        pathNot: [
          "^packages/core/src/signer/",
          "^packages/core/src/(models|ports)/",
          "^packages/core/src/vault/(base64|signer|message-signing)\\.ts$",
          "node_modules/hash-wasm/",
        ],
      },
    },
    {
      name: "signer-importers",
      comment: "Only the key session, the unlock path and the keyring import core/signer. Sign through a Signer from getSigner(walletId).",
      severity: "error",
      from: { pathNot: SIGNER_IMPORTERS },
      // `zeroize.ts` wipes buffers and holds no key; the passkey unlock wipes its PRF output with it.
      to: { path: "^packages/core/src/signer/", pathNot: "^packages/core/src/signer/zeroize\\.ts$" },
    },
    {
      name: "no-aoconnect",
      comment: "AO messages are built and signed with plain WebCrypto (core/ao/transfer.ts); aoconnect's browser build breaks raw-JWK signing in Chrome.",
      severity: "error",
      from: {},
      to: { path: "(^|/)@permaweb/aoconnect(/|$)" },
    },
    {
      name: "page-handlers-never-hold-approval",
      comment:
        "handlers/provider.ts gets grants as two functions, never the approval handler, so a page method opens a window only through the requestApproval its call carries.",
      severity: "error",
      from: { path: "^packages/runtime/src/handlers/provider\\.ts$" },
      to: { path: "^packages/runtime/src/handlers/approval\\.ts$", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "app-never-reaches-signer",
      comment: "Nothing the popup, side panel or phone UI loads may lead to core/signer, through any chain of imports.",
      severity: "error",
      from: { path: "^packages/(app|ui|keystone|provider)/src/" },
      to: { path: "^packages/core/src/signer/", pathNot: "^packages/core/src/signer/zeroize\\.ts$", reachable: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "\\.test\\.tsx?$",
        "\\.testing\\.tsx?$",
        "/testing/conformance/",
        "\\.d\\.ts$",
        "/(dist|\\.output|\\.wxt|node_modules)/",
      ],
    },
    tsPreCompilationDeps: true,
    // The extension's `@/` and `~/` aliases; the other projects have none.
    tsConfig: { fileName: `${__dirname}/.dependency-cruiser.tsconfig.json` },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
      mainFields: ["module", "main", "types"],
    },
    skipAnalysisNotInRules: true,
  },
};
