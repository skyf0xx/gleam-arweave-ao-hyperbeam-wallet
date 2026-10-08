# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## Gleam Points

Spec: `POINTS.md`. Items marked 👤 are for Will. Everything else is
code work.

### 👤 Setup

- 👤 🧪 Load `.output/chrome-mv3` unpacked and run the live flow: join with
  a wallet, check the Points screen loads its score from the server, and
  open an invite link before a fresh install. The unpacked build has a
  different extension id than the store, so the welcome-page handoff
  only works from the store build (the e2e test covers it locally).
- 👤 Before launch: legal review of the points wording in
  `apps/site/points.html` (§ The rules), `terms.html` (§ Gleam Points) and
  `privacy.html` (§ Gleam Points). The privacy page promises deletion of a
  wallet's points data on request by email; that's a manual delete from
  `wallets`, `snapshots` and `points` for now.

## Not planned

- Wander's deprecated `{ algorithm, hash, salt }` encrypt/decrypt stays
  refused (`provider-params.ts` `readEncryptAlgorithm`). Wander deprecated
  it and no dApp has asked for it. Wander's source specifies it fully if
  that changes.
- `userTokens` doesn't set `Logo` (`reads.ts`): `TokenBalance` doesn't
  carry the spawn-tag logo, and no dApp has asked for it.
- Upload is disabled in Settings until bundler uploads work with current
  AO wallets; re-enabling means restoring the row's `onOpenUpload` wiring.
- Pinning back to Vite 7. We stay on Vite 8: `packages/core/src/arweave/client.ts`
  handles its CommonJS default-import interop, and `pnpm test:smoke`
  catches the next bundle-only crash like it.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->

- **M** 🧪 ❓ `opus` — "Connect with Gleam" prompt for dApps without a
  Gleam button (`entrypoints/content`, `entrypoints/background`). dApps only
  show Wander/permawebOS buttons, so Gleam is invisible until they add one.
  When a page is detected as an Arweave dApp and the origin has no
  permissions, offer a one-click connect that runs the normal `connect`
  approval, then fire `walletSwitch`/`arweaveWalletLoaded` so the page
  re-checks, with a "reload to finish" fallback. Needs a per-site
  "don't show again" and a global toggle in Settings.
  - ❓ **Surface: prefer no page injection.** Injecting UI into third-party
    pages invites heavier Chrome Web Store review. Default to extension-owned
    surfaces only: toolbar badge/icon state on the tab, with the connect
    button in the popup or side panel. Fall back to an in-page pill (shadow
    root, user click only) only if that proves too hidden.
  - ❓ **Detection heuristics.** Candidate signals, read-only: the page
    offers the permawebOS wallet (its connect option or injected object is
    present), arweave-wallet-kit / Wander Connect globals, aoconnect, or
    `arweaveWalletLoaded` listeners. Decide which to use and whether the
    prompt is on by default.
- `packages/core/src/ao/transfer.ts`: its private `bytesToBase64Url` and
  `base64UrlToBytes` duplicate `vault/base64.ts`. Switch to the shared ones.
