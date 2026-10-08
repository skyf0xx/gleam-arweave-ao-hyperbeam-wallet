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

- 👤 Before launch: legal review of the points wording ("may be
  considered in a future distribution", eligibility review, no promised
  value).

### Build

- **feat(site): invite links and first-run code handoff.** Add
  `invite.html` (store the code, redirect to the store). `welcome.html`
  sends the code via `chrome.runtime.sendMessage`. The extension gets
  `externally_connectable` for the site origin and an
  `onMessageExternal` handler that writes the code to
  `local:points:pendingInviteCode` (format check only). `joinPoints`
  already reads it. **M** · 🧪 · `sonnet`
- **feat(points): header chip and points sheet.** Implement them per
  `POINTS.md` § Extension and `DESIGN.md`. The chip ticks with the local
  estimator, and the sheet has a manual invite-code field. Joining calls
  `joinPoints`, and the sheet needs a background `getPointsScores` that
  signs `POST /me`. The 🧪 check covers joining, the heartbeat, and the
  score read against the live API. **M** · 🧪 ·
  `sonnet`
- **docs(site): points rules, privacy and terms.** Add a "How points work"
  page and update `privacy.html` (device key, the server-side link
  between wallets on one install, heartbeat data) and `terms.html`
  (eligibility review, no promised value). **S** · ❓ legal wording ·
  `sonnet`

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

- `packages/core/src/ao/transfer.ts`: its private `bytesToBase64Url` and
  `base64UrlToBytes` duplicate `vault/base64.ts`. Switch to the shared ones.
- `packages/core/src/ao/balance.ts`: HyperBEAM answers 404 for an address
  the AO token never credited, and `getTokenBalance` throws on it. A fresh
  wallet may show an AO balance error instead of 0. The points API
  already reads 404 as 0 (`apps/points-api/src/balances.ts`).
