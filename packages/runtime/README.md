# @gleam/runtime

The wallet's background logic with no platform in it: the dispatcher that
decides who may call what, and every handler that does the work. A shell
(today the Chrome extension) builds a `Platform` from its own adapters,
passes it to `createRuntime`, and feeds the result its messages and
lifecycle events.

Nothing here imports `chrome.*`, WXT, `@webext-core/*`, Capacitor, or a
shell's code; ESLint fails the build if it does. Storage, timers, windows,
tabs, downloads and the device key all arrive through `Platform`, whose
ports are `@gleam/core`'s plus `TabsPort` and `LockIndicatorPort`. Network
access is injected the same way as in core.

## Components

- [`create-runtime.ts`](#create-runtimets) — builds the handlers and the dispatcher
- [`platform.ts`](#platformts) — what a shell must supply
- [`dispatch/`](#dispatch) — the privilege table and the site entry point
- [`handlers/`](#handlers) — one file per use case
- [`points-invite.ts` / `points-attest.ts`](#points-invitets--points-attestts) — the Gleam site's messages

### create-runtime.ts

`createRuntime(platform)` returns a `Runtime`: `dispatch` answers a
`ProtocolMap` message from a `CallerContext`, `dispatchSite` answers the
Gleam site's messages, and `start`, `onBrowserStartup`, `onTabClosed`,
`onIdleStateChanged` and `onInstalled` take the shell's lifecycle events.
It is the one place that enforces `dispatch/methods.ts` before a handler
runs, and it owns the periodic jobs (auto-lock, activity promotion, the
points heartbeat), idle-lock, and pushing provider events to open tabs.
Its `timer` listeners are registered while it runs, so a shell calls it
synchronously at the top level of its worker.

### platform.ts

The `Platform` interface: storage, session keys, approval presenter,
timer, device key, badge, lock indicator, downloads, tabs, the release
version, and `dev`. `dev` is true in a development build, which also
accepts site messages from `localhost`.

### dispatch/

- **`methods.ts`** — every method's caller tier, whether it can open an
  approval, and the zod schema its page-supplied params are parsed with.
  This table is the privilege boundary to audit; no handler re-checks it.
  `SITE_MESSAGES` lists what the Gleam site's pages may send.
- **`site.ts`** — `dispatchSiteMessage`, the one way in for those
  messages: it checks the sender's origin and the message's schema before
  any handler runs.

### handlers/

Each handler depends only on ports, never on a platform API.

- **`wallet-lifecycle.ts`** — create, import, lock/unlock, rename, delete, and switch wallets.
- **`key-session.ts`** — holds the unlocked signer through `SessionKeyStorePort` and enforces auto-lock. Only it and `wallet-lifecycle.ts` import `core/signer`.
- **`reads.ts`** — balances, token balances and metadata, activity, prices, network settings.
- **`transfer.ts`** — AR/AO transfer estimate and submission.
- **`upload.ts`** — ANS-104 upload review and submission.
- **`approval.ts`** — the connect/sign/encrypt/decrypt/add-token/scan-attestation approval lifecycle, through `ApprovalPresenterPort`.
- **`provider-params.ts`** — decodes and validates the wire params for every `window.arweaveWallet` method.
- **`announcements.ts`, `contacts.ts`, `points.ts`, `review-prompt.ts`, `scans.ts`, `security-phrase.ts`, `site-wallet.ts`, `passkey.ts`** — one handler each for their named feature. `attest-errors.ts` words the points API's refusals for the person signing.

### points-invite.ts / points-attest.ts

Handle the site's invite-code and scan-attestation messages once
`dispatchSiteMessage` has checked them, handing off to `points.ts` or
`approval.ts`.

## Tests

Tests sit next to the file they test and stub `fetch` and the ports; none
need a browser.
