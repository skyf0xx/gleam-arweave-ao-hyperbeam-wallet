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

### 👤 Setup (before the server items)

- 👤 Create a Vercel project for `apps/points-api`, using the same Vercel
  account as the site. Add a Neon Postgres database from the Vercel
  Marketplace. Pick a domain such as `points.<site-domain>`, or use the
  default `*.vercel.app`.
- 👤 Set these env vars on that project (Production and Preview):
  - `DATABASE_URL`: set automatically by the Neon integration.
  - `CRON_SECRET`: a random 32+ character string. Vercel Cron sends it
    as a bearer token.
  - `ARWEAVE_GATEWAY_URL`: `https://arweave.net` unless you prefer
    another gateway.
  - `HYPERBEAM_URL`: the HyperBEAM peer for AO balance reads. Defaults to
    the extension's first `DEFAULT_HYPERBEAM_PEER_URLS` entry.
  - `ALLOWED_ORIGIN`: the extension origin
    `chrome-extension://<store extension id>`.
- 👤 Send me the points API base URL and the Chrome Web Store extension
  ID. The extension's build-time constant and `externally_connectable`
  both need them.
- 👤 Before launch: legal review of the points wording ("may be
  considered in a future distribution", eligibility review, no promised
  value).

### Build

- **feat(points): points formula and signed-message builders in core.**
  Add `packages/core/src/points/` with the register, heartbeat and score
  payload builders, the daily formula (`base`, referee and referrer bonus,
  integer-only) and the local estimator, plus tests. **M** · `opus`
- **feat(points-api): scaffold apps/points-api with schema and
  migrations.** Add a new workspace app (Vercel Functions, TypeScript,
  `@neondatabase/serverless`), plain SQL migrations for the four tables,
  and tsc/eslint/vitest wiring. Add it to lefthook and CI. **M** · `sonnet`
- **feat(points-api): register and heartbeat endpoints.** Verify the RSA-PSS
  registration signature with `@gleam/core` `verifyMessage`, derive the
  address from `n`, check the ECDSA device signature on heartbeats,
  reject stale timestamps, apply an invite code only to the device's
  first wallet, and rate-limit. **M** · `opus`
- **feat(points-api): daily snapshot cron.** Read every live wallet's AR
  and AO balances in one bounded-concurrency pass. Write `snapshots` and
  `points` in one transaction, idempotent per day. If the run takes over
  about 250s, switch to batched runs. **M** · `sonnet`
- **feat(points-api): signed score endpoint.** `POST /me` returns
  per-wallet totals, today's rate, percentile, number of referees and
  invite code. **S** · `sonnet`
- **feat(points): device key and heartbeat in the extension.** Create a
  non-extractable P-256 key in IndexedDB on first need and send the
  heartbeat from a daily `browser.alarms` alarm in `handlers/points.ts`.
  Add the points API host to `host_permissions`. **M** · 🧪 · `opus`
- **feat(points): opt-in registration.** Add a `ProtocolMap` method and a
  handler that signs the register payload with the active wallet's
  session key and posts it. Store the returned invite code per wallet.
  **M** · 🧪 · `opus`
- **feat(site): invite links and first-run code handoff.** Add
  `invite.html` (store the code, redirect to the store). `welcome.html`
  sends the code via `chrome.runtime.sendMessage`. The extension gets
  `externally_connectable` for the site origin and an
  `onMessageExternal` handler that keeps a pending code (format check
  only). **M** · 🧪 · `sonnet`
- **feat(points): header chip and points sheet.** Implement them per
  `POINTS.md` § Extension and `DESIGN.md`. The chip ticks with the local
  estimator, and the sheet has a manual invite-code field. **M** · 🧪 ·
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
