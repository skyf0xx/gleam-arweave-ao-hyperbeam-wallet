// Any path into `packages/core/src/signer`: the `@gleam/core/signer`
// subpath, any path through `src/signer`, or `../signer` anywhere in a
// relative path (so `../ao/../signer` counts too). `vault/signer.ts` (the
// `Signer` interface) is `./signer` from inside `vault/` and stays
// importable. `dirTail` follows the folder name, so an override can let
// one file through.
export const signerImport = (dirTail = "(/|$)") =>
  `^@gleam/core/signer(/|$)|(^|/)(\\.\\.|src)/signer${dirTail}|^\\./signer/`;
export const SIGNER_IMPORT = signerImport();
export const SIGNER_IMPORT_MESSAGE =
  "Only key-session.ts, wallet-lifecycle.ts, backup.ts and the keyring import core/signer. Sign through a `Signer` from `getSigner(walletId)`.";

// `no-restricted-globals` sees a bare `chrome`, not `globalThis.chrome`.
export const NO_GLOBAL_OBJECT_EXTENSION_API = ["globalThis", "self", "window"].flatMap((object) =>
  ["chrome", "browser"].map((property) => ({
    object,
    property,
    message: "Shell-free packages never touch extension globals. Reach the platform through a port.",
  })),
);
export const signerFence = (regex) => ({
  "no-restricted-imports": ["error", { patterns: [{ regex, message: SIGNER_IMPORT_MESSAGE }] }],
  "gleam/no-dynamic-import": ["error", { regex, message: SIGNER_IMPORT_MESSAGE }],
});

// `packages/runtime` runs in any shell (the extension's service worker, a
// mobile app), so it reaches a platform only through `Platform`. Block the
// shells' SDKs, both shells, their `@/` and `~/` aliases, and the extension
// globals. `(^|/)apps/` also catches a relative climb into `apps/`.
export const RUNTIME_IMPORT = "^(wxt|@capacitor|@capacitor-community|@capgo|@webext-core)(/|$)|(^|/)apps/(extension|mobile)(/|$)|^[@~]/";
export const RUNTIME_IMPORT_MESSAGE =
  "packages/runtime is shell-free: no wxt, Capacitor plugins, @webext-core or apps/*. Take what you need through `Platform`.";
const RUNTIME_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/runtime never touches extension globals. Add a port to `Platform` and let the shell implement it.",
}));
export const runtimeFence = (...extraPatterns) => ({
  "no-restricted-imports": [
    "error",
    { patterns: [...extraPatterns, { regex: RUNTIME_IMPORT, message: RUNTIME_IMPORT_MESSAGE }] },
  ],
  "no-restricted-globals": ["error", ...RUNTIME_GLOBALS],
});

// `packages/app` is every screen, and any shell mounts it, so like the
// runtime it reaches a platform only through `AppPlatform`. The same SDKs,
// shells, aliases and globals are blocked.
export const APP_IMPORT_MESSAGE =
  "packages/app is shell-free: no wxt, Capacitor plugins, @webext-core or apps/*. Take what you need through `AppPlatform`.";
// The hardware-wallet libraries belong to a shell's signing panels, which
// it hands the app through `AppPlatform.hardwareWallets`. Imported from
// `packages/app`, they would land in the popup and the phone bundle.
export const HARDWARE_IMPORT = "^@(keystonehq|ngraveio|ledgerhq)(/|$)";
export const HARDWARE_IMPORT_MESSAGE =
  "packages/app doesn't import hardware-wallet libraries. The shell provides its signing panels through `AppPlatform.hardwareWallets`.";
export const APP_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/app never touches extension globals. Add a port to `AppPlatform` and let the shell implement it.",
}));
export const KEYSTONE_IMPORT_MESSAGE =
  "packages/keystone is shared by both shells: no wxt, Capacitor plugins, @webext-core or apps/*. Take shell-specific copy or behaviour as props.";
export const KEYSTONE_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/keystone never touches extension globals. Take what differs per shell as props.",
}));

// `packages/provider` runs in the page's own world, where anything it
// loads is reachable by the page, and any shell injects it. Beyond the
// shell fence, it takes no wallet logic: nothing from core, runtime, app
// or ui, and from messaging only the page wire contract. A relative climb
// out of the package counts too.
export const PROVIDER_IMPORT =
  "^@gleam/(core|runtime|app|ui)(/|$)|(^|/)packages/(core|runtime|app|ui|messaging)(/|$)|^(\\.\\./){2,}(core|runtime|app|ui|messaging)(/|$)|^@gleam/messaging(?!/src/page-protocol(\\.ts)?$)";
export const PROVIDER_IMPORT_MESSAGE =
  "packages/provider is page-world code: no wxt, Capacitor plugins, @webext-core, shell apps, or @gleam/core/runtime/app/ui, and only page-protocol from @gleam/messaging. Reach the wallet through `ProviderTransport`.";
export const PROVIDER_GLOBALS = ["chrome", "browser"].map((name) => ({
  name,
  message: "packages/provider never touches extension globals. Reach the wallet through `ProviderTransport`.",
}));

// Flat config replaces a rule's options wholesale when a later block sets
// the same rule, so every block that sets `no-restricted-syntax` spreads
// in the full list it needs rather than adding to an earlier block's.
//
// Wallet pages hold unlocked keys, so markup is never parsed into their
// DOM: render images through <img> and text through React.
export const NO_HTML_INJECTION = [
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
export const NO_RAW_KEY = [
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
export const NO_LITERAL_ERROR_THROW = [
  {
    selector:
      "ThrowStatement > NewExpression[callee.name='Error'] > :matches(Literal[value=/./], TemplateLiteral).arguments:first-child",
    message:
      "Throw `new Error(userErrorMessage(code))` for text a person can reach, or `new Error(dappError(...))` for English by design.",
  },
];
export const NO_DYNAMIC_SIGNER_IMPORT = [
  {
    selector: "CallExpression[callee.name='require'], ImportExpression",
    message: "core/signer uses static imports only, so the import fence above can check them.",
  },
];

export const maxLines = (max) => ["error", { max, skipBlankLines: true, skipComments: true }];
