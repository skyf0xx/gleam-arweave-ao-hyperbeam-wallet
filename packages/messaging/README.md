# @gleam/messaging

The typed wire contracts between the extension's separate JS contexts:
popup/side panel, background service worker, content script, injected
page provider, and the keyring offscreen document, plus the messages the
Gleam site's own pages send the extension.

No logic lives here. This package holds only message shapes, constants,
and the type-level privilege grouping that a later layer (the
background dispatcher) enforces at runtime.

Splitting the contract out from the background lets popup/UI code import
message types without pulling in any background code. The project's
hexagonal rule — UI never imports background code — depends on that
split.

## Components

- [`protocol.ts`](#protocolts) — the extension-wide RPC contract
- [`page-protocol.ts`](#page-protocolts) — the page ↔ content script wire format
- [`keyring-protocol.ts`](#keyring-protocolts) — the background ↔ keyring port contract
- [`site-protocol.ts`](#site-protocolts) — the Gleam site → extension messages
- [`permissions.ts`](#permissionsts) — re-exported privilege-tier vocabulary
- [`caller.ts`](#callerts) — who sent a message, as the platform attests it

### protocol.ts

Defines `ProtocolMap`, the single interface covering every RPC method
any extension page (popup, side panel, approval window, content script)
can send to the background: wallet lifecycle, balance/activity reads,
transfers, uploads, approvals, settings, Gleam Points, and site
connection state. `@webext-core/messaging`'s `defineExtensionMessaging`
turns this interface into typed `sendMessage`/`onMessage` pairs.

This file only pins the wire shape — request/response types. It does
not enforce who may call what. That's the dispatcher's job in
`packages/runtime`, using the privilege tiers from `permissions.ts`.

One method, `providerCall`, is the choke point for every page-originated
request. The content script forwards a dApp's call here instead of
through any of the map's other methods, and the dispatcher checks it
against `PROVIDER_METHODS` before routing it. `resolveApproval`/
`getApproval` and `createWallet`/`importWallet`/`downloadKeyfile` are
different: they're only ever called directly by their own trusted
senders, never through `providerCall`.

### page-protocol.ts

Defines the `postMessage` envelope format between the page the dApp runs
in and the content script.

- Request/response/event envelopes.
- The `ProviderSurfaceMethod` list — the ArConnect-compatible
  `window.arweaveWallet` surface.
- `encodeTaggedBinary`/`decodeTaggedBinary`, which round-trip
  `ArrayBuffer`/`Uint8Array` values through `postMessage` and
  `chrome.storage`'s JSON serialization (which otherwise drops binary
  data).

`PROVIDER_SURFACE_METHODS` is the page's entire reachable method set. A
page-originated message can never reach `KEY_METHODS` or
`APPROVAL_METHODS` — though enforcing that boundary is still the
dispatcher's job, not this file's.

### keyring-protocol.ts

Defines the contract for one long-lived `runtime.connect` port between
the background and the keyring offscreen document, which holds unlocked
wallets' non-extractable keys.

This is separate from `ProtocolMap` because a port, unlike
`runtime.sendMessage`, is only ever delivered to the one page that
opened it. That way, key material (e.g. an imported JWK) never risks
reaching another open extension page.

### site-protocol.ts

Defines what the Gleam site's pages send over `externally_connectable`
and what they get back. `SiteAttestRequest` is `attest.html` handing over
a community scan attestation; `SiteAttestResponse` is the reply once the
user has finished in Gleam's window: the points earned, or a
`SiteAttestErrorCode` with one sentence to show. The site reads these
shapes; `packages/runtime/src/dispatch/methods.ts` holds the schemas it
checks them with, and `dispatch/site.ts` enforces them.

### permissions.ts

Re-exports `PermissionType`/`PERMISSION_TYPES` and the method privilege
tiers (`PROVIDER_METHODS`, `APPROVAL_METHODS`, `KEY_METHODS`) from
`@gleam/core`. This package is the messaging contract's named home for
that vocabulary, even though the tiers themselves are core domain
concepts.

### caller.ts

Defines `CallerContext`, the caller the background dispatcher sees for
each message: the `extension` tier for the wallet's own pages, or the
`contentScript` tier with the page's `origin` and `tabId`. The
extension's transport builds it from Chrome's `runtime.MessageSender`
(`apps/extension/src/sender.ts`), never from the message body, so a page
can't name its own origin or tier.

## How it's used

- `packages/ui` and `apps/extension`'s popup/side panel/approval code
  import `ProtocolMap` types to call `sendMessage`.
- The background dispatcher (`packages/runtime/src/handlers/`)
  implements each `ProtocolMap` method and enforces the
  `PROVIDER_METHODS`/`APPROVAL_METHODS`/`KEY_METHODS` boundary before a
  handler runs.
- The content script and injected provider script speak
  `page-protocol.ts`'s envelope format to each other.
- The content script re-encodes page requests as `providerCall`
  messages to reach the background.
