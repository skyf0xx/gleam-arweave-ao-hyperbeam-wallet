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
