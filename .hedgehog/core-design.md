# Core design — gleam-wallet (authored)

## System shape

A browser extension: a Chrome MV3 wallet for Arweave/AO, with a popup and
sidepanel UI, a content-script/injected-page bridge exposing
`window.arweaveWallet` to dApps, and a background service worker. Not
`full-stack-app` — there is no server of this project's own; all reads go
to public Arweave gateways, HyperBEAM nodes, and pricing APIs the project
doesn't operate. Not `pwa-app` — this is extension-first, not an
installable web app, and its cross-context messaging (background/content/
popup as separate JS runtimes) is architecturally central in a way no
shipped core's `when` paragraph names.

## Stack

TypeScript + WXT (bundles entrypoints, generates the manifest, MV3 +
sidepanel support), Vitest, pnpm — the browser-extension shape's listed
default, no substitution. Confirmed independently by prior research in
the sibling `ao-wallet` repo's `ARCHITECTURE.md`, which arrived at the
same stack plus:
- React 19 for UI (best logic-reuse path toward a future React Native
  port)
- Tailwind CSS 4 (native container queries, required for popup/
  sidepanel/approval surfaces sharing one component at different sizes;
  no runtime style injection, MV3-CSP-safe)
- Radix UI via shadcn/ui, copied into the tree rather than installed (no
  runtime style injection, no CSP nonce problem)
- `@webext-core/messaging` for the typed `ProtocolMap` contract
- `arweave-js` (canonical Arweave client, MV3-verified via a passed spike)
  and `@dha-team/arbundles` (ANS-104 signing; upstream `arbundles` is
  stale)
- `@tanstack/react-query` for shared wallet state (token balances,
  activity feed) — keyed async server-state with cache invalidation on
  mutation (send/receive, future bridging), chosen over hand-rolled state
  because the wallet now has an open-ended set of token balances plus a
  transaction history feed that both need refetch-on-mutation semantics

These are library choices within the stack the blueprint already
specifies, not shape-level substitutions, so they're recorded here as
detail rather than as a deviation from the stack table.

- **Composition**: explicit — a small ports/adapters split
  (`core/ports/*.ts` interfaces, `apps/extension/src/adapters/*.ts`
  implementations), no DI container. `core` never imports an adapter
  directly; the extension's entrypoints wire concrete adapters to ports
  at startup.
- **Error model**: typed rejections surfaced through
  `@webext-core/messaging`'s response envelope; `core` functions throw
  typed errors (e.g. "invalid keyfile", "insufficient balance") that
  handlers catch and translate into the messaging contract's error shape.
- **Config and secrets**: `NetworkSettings` (gateway URL, HyperBEAM peer
  list) is user-editable state persisted via the storage port, not
  environment variables — there is no server deployment to configure.
  No secrets belong to this project; user key material lives only in the
  per-wallet encrypted vault envelope.
- **Entrypoint layout**: `apps/extension/entrypoints/{background,content,
  provider,popup,sidepanel,approval}` per WXT's file-based entrypoint
  convention; `apps/extension/src/App.tsx` is the one shared shell
  mounted with a different `layout` prop per surface.

## Layers — blueprint used and what changed

Started from `blueprints/browser-extension.md`'s four-layer sketch
(`messaging → background → content → popup`) and adapted it against the
actual feature set mined into `04-prd.md`, because the blueprint's layers
name *where code runs* (background/content/popup) while this project's
real risk boundaries are *what the code does* (vault crypto vs. wallet
reads vs. the dApp-facing surface) — code in all three blueprint contexts
appears inside a single feature here (e.g. onboarding touches popup UI,
a background handler, and a storage adapter together). Kept the
blueprint's core insight — `messaging` first, popup/UI code never
importing background code directly — and expanded it into 7 layers that
track the sibling repo's own phased build order
(`ARCHITECTURE.md §6`) instead of the blueprint's context split:

1. **scaffold** — repo skeleton, workspace config, design tokens,
   shadcn-derived primitives, ESLint import-boundary rule, and the bare
   `App` shell mounted from popup/sidepanel with a placeholder view.
   Owns nothing behavior-specific; every later layer builds against it.
2. **messaging** — the typed `ProtocolMap` contract plus the domain
   models it references (`core/src/models/`) and the two ports
   (`windows`, `runtime`) the contract's shape implies. Pinned first, per
   `hexagonal`'s contract-before-consumers rule: nothing else can be
   built against an unstable wire format.
3. **vault** — `core/vault` + `core/keys`: envelope crypto, JWK
   generation/import, zeroization, the storage port. Pure domain logic,
   no UI, the one layer the sibling repo's own architecture doc calls
   "non-negotiable" to unit-test heavily. Everything downstream signs or
   reads through this.
4. **onboarding-unlock** — the first genuinely demoable slice: create/
   import a wallet, lock, unlock, see an address. Wires vault + messaging
   through real popup screens and the storage/runtime adapters.
5. **wallet-core** — AR balance, AO token balances, send, receive,
   activity feed. Grouped into one layer rather than split further (per
   explicit confirmation) because they share one read/write shape against
   `arweave-js`/HyperBEAM/the gateway GraphQL endpoint and none
   introduces an independent architectural boundary the others don't
   already cross.
6. **upload** — compose/tag/secret-scan/bundler-submit. Kept separate
   from wallet-core because it owns a distinct risk surface (the
   pre-upload secret scanner) the sibling repo's spec treats as its own
   concern (`core/policy`).
7. **provider-bridge** — the injected `window.arweaveWallet` provider,
   the postMessage bridge, connection-request approval, signing approval,
   and connected-apps management. Built last: it depends on vault and
   wallet-core both being solid before exposing them to untrusted page
   content, and it's the sibling repo's own "Phase 1b" grouping.

No cross-cutting `once: true` layer: this is a linear chain (see below),
so Step 4's cross-cutting-infrastructure question doesn't apply — there
is only one build, not several modules that could each reinvent shared
state.

## Module axis: none (linear chain)

The mined Features aren't repeating units of the same shape (unlike, say,
`full-stack-app`'s one-table-per-module) — they're capabilities layered
once onto one shared vault/messaging/UI foundation, and the sibling
repo's own build order treats them as a single ordered sequence, not
parallel instances. Confirmed with the user directly. The graph is one
task per layer, mined as a single intent; no `{module}` placeholder
appears anywhere in `core.yaml`.

## Pattern: hexagonal

*These layers are ordered so that dependencies point inward toward
`vault` and `messaging`: `wallet-core`, `upload`, and `provider-bridge`
all depend on the vault's signing/key logic and the messaging contract,
never the reverse, and `popup`-side UI code never imports
background-adapter code directly — every cross-context call crosses
`messaging`.* This is the blueprint's own declared boundary
(`browser-extension.md`'s "Boundary that must hold"), carried forward
unchanged: adaptation expanded the layer count but did not collapse the
messaging/vault-as-inward-boundary property that makes it true.

## Push/deploy (Step 4c)

No layer in this sequence deploys, publishes, or otherwise acts on a
system outside the working tree — publishing the extension to the Chrome
Web Store is an out-of-band step after this build, not itself a layer in
this build's scope. N/A.

## Reachability gate (Step 4d)

Nothing this project publishes is reached through an arbitrator (no
ingress/router/gateway in front of it) — a linear chain also cannot
produce the multi-surface-disagreement defect this gate exists to catch,
since it mines as one intent, one surface. N/A.

## Compressed intake

`.hedgehog/BMAD/00-manifest.md` records a compressed intake: this
architecture was designed from the sibling `ao-wallet` repo's existing
product brief, technical spec, and 16 built screen mockups, plus one
batched confirmation round with the user (intake mode, repo layout,
layer grouping) — not from a live BMAD elicitation session in this
project. The stack and layer choices rest on that pre-existing research
rather than freshly-elicited drivers; the sibling repo's material is
substantially more detailed than a typical compressed brief (a full
architecture doc with a phased build order, not just a one-paragraph
description), so the input is thinner only in the sense that this
session didn't independently re-derive it.

## Correction Protocol log

- **`apps/extension/src/App.tsx` moved from `scaffold`'s original scope
  into `wallet-core`'s scope.** `scaffold` built the bare shell with a
  placeholder view and no switch logic; neither `onboarding-unlock` nor
  `wallet-core` originally had this file in scope, so nothing could wire
  `OnboardingView`/`UnlockView` (built complete and independently
  testable by `onboarding-unlock`, see its debt notes) into the actual
  popup. Assigned to `wallet-core` — confirmed with the user directly —
  since it's the layer that adds `main-screen`, the third and last view
  needed before the view-switch is worth wiring once rather than twice;
  `wallet-core` wires all three views' switch logic together when it
  builds. Already covered by `wallet-core`'s existing `apps/extension/**`
  `verify_radius`, no radius change needed. `pnpm wxt build` added to its
  `verify` command (was tsc/tests only) since it now owns an entrypoint
  file WXT bundles — a broken view-switch could typecheck and unit-test
  clean while still failing to actually build/mount, per this skill's
  "a layer whose output a framework compiles must run that build in its
  verify" rule.

- **`packages/core/src/index.ts` added to `messaging`'s scope** (was
  missing from every layer's scope entirely). `scaffold`'s
  `packages/core/package.json` declares `main`/`types` as
  `./src/index.ts`, but no layer's original scope glob covered creating
  that file — a gap discovered when `messaging`'s build (the first real
  consumer of `@gleam/core` as a package import) found `@gleam/core`
  failed to resolve (`TS2307`) with no barrel file present. Assigned to
  `messaging` since it's the earliest layer that needs the import to
  resolve, and the file is a trivial one-line re-export barrel with no
  behavior of its own — not a layer-boundary or sequencing problem, a
  missing path in one glob.
- **`packages/core/src/ports/ports.models.test.ts` added to
  `messaging`'s scope.** `windows.ts` and `runtime.ts` were granted
  individually (not a `ports/**` glob, to avoid future collision with
  `vault`'s later `storage.ts`), but their colocated test file wasn't
  included alongside them. Added the specific test-file path rather than
  a directory glob, for the same collision-avoidance reason.
- **`packages/core/src/index.ts` also added to `onboarding-unlock`'s
  scope**, plus `packages/core --noEmit` added to its verify command and
  `packages/core/**` to its `verify_radius`. `vault`'s build (correctly)
  left the barrel untouched since it was outside `vault`'s own scope —
  the barrel is owned by `messaging`'s scope, not `vault`'s — so it still
  only exports `models`, not `vault`/`keys`/`ports`. `onboarding-unlock`
  is the first layer that actually needs those exports (it wires the
  storage/runtime adapters and the vault to real UI), so it's the
  layer that updates the barrel. Confirms the same class of gap as
  above: a shared package-entry file has no single obvious owner among
  per-concern layer scopes, and each layer that first needs a given
  export is where that export gets added.
- **`apps/extension/package.json` and `pnpm-lock.yaml` widened via a
  per-task override on `onboarding-unlock`, then committed separately as
  their own `chore(workspace)` commit** (per `hedgehog verify`'s own
  scope-violation guidance: "shared workspace config — no layer owns it;
  commit it separately"), and removed from the override once landed.
  `runtime.ts` is the first file to import `@webext-core/messaging`
  directly (an already-locked stack dependency, previously only a
  transitive dep via `@gleam/messaging`), so it needed declaring in the
  extension's `package.json`, which touches the workspace lockfile.
  Unlike the barrel-file gap above, these two files are genuinely shared
  indefinitely — any later layer may equally need to add its own
  dependency — so neither a permanent `core.yaml` grant nor a persisted
  override was right; a separate, layer-agnostic commit is. A later
  layer needing the same files makes its own `chore(workspace)` commit
  when it arrives.
- **`apps/extension/src/{adapters,handlers}/*.test.ts` colocated test
  files added to `onboarding-unlock`'s scope** (three files:
  `wallet-lifecycle.onboarding.test.ts`, `storage.unlock.test.ts`,
  `runtime.unlock.test.ts`). `wallet-lifecycle.ts`/`storage.ts`/
  `runtime.ts` were granted individually (not directory globs, to avoid
  future collision in the shared `adapters`/`handlers` directories later
  layers also write into), but their colocated test files weren't
  included alongside them — the same gap shape as `messaging`'s
  `ports.models.test.ts` fix above.
- **`apps/extension/src/App.tsx` view-switch wiring is an unresolved
  gap, not yet assigned to any layer.** `onboarding-unlock` built
  complete, independently-mountable `OnboardingView`/`UnlockView`
  components, but `App.tsx` itself is `scaffold`'s scope (a locked,
  completed layer) and no later layer's scope re-lists it either. Until
  a layer is granted this file, nothing in the graph can wire the actual
  view-switch that mounts these components from the popup shell. Needs a
  scope decision before `wallet-core` (which will add its own
  `main-screen` view and hit the identical problem) — see the "Left
  unresolved" section below.
- **No `ProtocolMap` wire-contract method for the destructive
  "forgot password" reset exists.** `messaging`'s `protocol.ts` is
  locked/complete and has no `resetAllWallets`-shaped RPC method.
  `onboarding-unlock` added `WalletLifecycleHandler.resetAllWallets()`
  or, and wired the `ForgotPassword` UI's confirmation flow, but left the
  actual RPC call unwired (`onResetComplete` fires optimistically) since
  adding a method to `protocol.ts` is outside this layer's scope. See
  "Left unresolved" below.

- **Colocated test-file paths pre-emptively added to `wallet-core`,
  `upload`, and `provider-bridge`'s scope**
  (`reads.activity.test.ts`, `transfer.send.test.ts`,
  `upload.upload.test.ts`, `content.provider.test.ts`,
  `provider.provider.test.ts`, `approval.approval.test.ts`,
  `windows.provider.test.ts`). Every prior layer that grants individual
  files rather than a directory glob (to avoid collision in shared
  `handlers`/`adapters`/`entrypoints` directories) has hit the same gap:
  its colocated test file wasn't included. Confirmed three times
  (`messaging`, `onboarding-unlock` ×3, `wallet-core` ×2) as a real,
  predictable pattern rather than one-off oversights, so the remaining
  three layers' scopes were corrected up front instead of waiting to hit
  it again layer by layer. Each new test-file path was checked against
  its layer's `verify` command's filter tokens for a match before adding.

- **`provider-bridge`'s scope widened to reopen `packages/messaging/src/
  protocol.ts` and three model files (`grant.ts`, `transfer.ts`,
  `upload.ts`), plus a new `apps/extension/entrypoints/background.ts`.**
  Confirmed with the user directly. Two accumulated debts needed
  resolving for the extension to be genuinely runnable end-to-end: (1)
  `TransferDraft`/`UploadDraft` carry no password/walletId field, so
  `wallet-core` and `upload` each locally widened their own handler
  request types as a workaround (debt declared on both tasks) — the real
  fix is adding those fields to the models/`ProtocolMap` themselves,
  which only this layer's dispatcher work makes a natural place to do;
  (2) no background entrypoint exists anywhere that actually registers
  `WalletLifecycleHandler`/`ReadsHandler`/`TransferHandler`/
  `UploadHandler` against real `onMessage` listeners — `provider-bridge`
  is the layer that needs a working dispatcher anyway (to enforce the
  `PROVIDER_METHODS`/`APPROVAL_METHODS`/`KEY_METHODS` privilege-tier
  boundary at a single choke point, per messaging's own rule), so it's
  the natural owner of `background.ts`. `grant.ts` was added so
  `getConnectedApps()`'s stub (wallet-core's debt) can be replaced with
  real Grant storage once this layer builds the connection-approval
  flow that creates Grants. Verify command and radius extended to
  typecheck `packages/messaging`/`packages/core` accordingly.

- **`content.ts`/`provider.ts`/`background.ts` converted from flat files
  to folders (`content/index.ts`, `provider/index.ts`,
  `background/index.ts`), each with its test file colocated as
  `index.test.ts`.** The layer's own scope originally granted flat
  `background.provider.test.ts`/`content.provider.test.ts`/
  `provider.provider.test.ts` files sitting directly under
  `entrypoints/` next to their flat `.ts` counterparts — exactly the
  naming collision the browser-extension blueprint's own "WXT entrypoint
  naming" section warns against (WXT derives an entrypoint's name by
  splitting at the first `.`, so `background.provider.test.ts` and
  `background.ts` both resolve to entrypoint name `"background"`), and
  `wxt build` failed outright with "Multiple entrypoints with the same
  name detected." Restructured into the same folder convention every
  other multi-file entrypoint in this project already uses (onboarding,
  unlock, main-screen, send, receive, activity, upload). Filter tokens in
  `verify` updated (`content/index`, `background/index` added; `provider`
  already matched `provider/index.test.ts`'s path) since the rename
  changed which files the original tokens matched — confirmed by hand
  that all 6 of this layer's test files still run under the corrected
  command.
- **`vite-plugin-node-polyfills` added as a dependency of
  `apps/extension`, wired into `wxt.config.ts`.** `@dha-team/arbundles`'s
  browser build (`arbundles/web`) still statically imports Node's
  `crypto`/`stream`/`events` in a few internal files (`deepHash.js`,
  `DataItem.js`, `Bundle.js`) despite using WebCrypto at runtime. This
  predates `provider-bridge` — `upload`'s own verify command never ran
  `wxt build`, so the gap was latent — and only surfaced once
  `background.ts` became the first entrypoint to transitively bundle
  `UploadHandler` → `upload-submit.ts` → `arbundles/web`. Confirmed with
  the user directly to fix properly (a real dependency + config change)
  rather than deferring as debt, since the extension can't build for real
  use otherwise.
- **`web_accessible_resources` for `provider.js` added to
  `wxt.config.ts`'s manifest.** Required for `content.ts`'s
  `injectScript("/provider.js", ...)` to resolve at runtime — WXT does
  not add this automatically (stated directly in its own
  `inject-script.mjs` doc comment) and nothing in any layer's scope had
  added it. Discovered and fixed as part of the same pass as the
  polyfill fix above, since both block the extension from being
  genuinely loadable in a real browser.
- **`wxt.config.ts` and `apps/extension/package.json`/`pnpm-lock.yaml`
  touched directly for these two fixes**, outside every layer's granted
  scope (`wxt.config.ts` is `scaffold`'s locked scope). Treated the same
  as the recurring "shared workspace config, no single layer owns it"
  pattern — not added to `provider-bridge`'s permanent `core.yaml` scope,
  fixed directly with the user's explicit go-ahead since this blocks the
  project's core deliverable (a genuinely buildable extension) rather
  than deferred as debt for a hypothetical future pass.
- **2026-09-15 — Debt #7 (`GLEAM-WALLET-WALLET-CORE`) ratified, no wire-
  contract change needed.** Debt #7 flagged that `handlers/transfer.ts`
  had widened its own request shape to `TransferDraft & { walletId;
  password }` as a workaround, and asked whether `TransferDraft` itself
  needed `walletId`/`password` added at the messaging layer before the
  `ao-token-send` intent's dispatcher wiring landed. By the time
  `ao-token-send` reached its `vault` layer, this was already moot:
  `provider-bridge`'s own earlier Correction Protocol entry (above) had
  already added `walletId` to the locked `TransferDraft` model as part of
  its `protocol.ts`/model-widening pass. No `password` field was ever
  added or is needed — signing resolves the JWK via
  `apps/extension/src/handlers/key-session.ts`'s in-memory unlocked-
  session cache (`getCachedKey(walletId)`), the same mechanism the AR
  path already used, never by re-deriving key material from a password.
  `ao-token-send`'s own `messaging` and `vault` layers independently
  confirmed `TransferDraft.walletId` is sufficient and correct as-is and
  made no further changes to it. **Ratified: `TransferDraft.walletId` is
  the authoritative wire shape for signing-key resolution on both the AR
  and AO transfer paths. No code change to the wire contract was needed
  for `ao-token-send` — only building the AO transfer path itself
  against the shape that was already there.**

## Left unresolved

- **HyperBEAM balance path** (`04-prd.md`'s AO token balances Feature):
  whether the `compute/` or `now/` key on `~process@1.0` is correct for a
  balance read is an open spike per the sibling repo's own
  `ARCHITECTURE.md §0.2/§7.3` — to be resolved when the `wallet-core`
  layer's task actually builds that feature, not a planning-time
  blocker.
- **Unlocked-session persistence across MV3 service-worker restarts**
  (`ARCHITECTURE.md §5.1/§7.2`): re-derive-on-demand vs. holding key
  material in the service worker is an open design question to resolve
  during the `vault` or `onboarding-unlock` layer's build, not fixed by
  this core design.
