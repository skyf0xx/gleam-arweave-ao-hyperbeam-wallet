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
  `privacy.html` (§ Gleam Points).
- 👤 **Launch blocker:** `privacy.html#points` already describes the
  self-serve "Leave Gleam Points" delete below as live. Ship that item
  before launch. Until it ships, honour a request by deleting from
  `wallets`, `snapshots` and `points` by hand.

### Build

- **M** 🧪 ❓ `opus` — **feat(points): let a wallet leave Gleam Points and
  delete its data.** `privacy.html#points` already describes this flow,
  so it must ship before launch. A self-serve delete in the wallet,
  signed by the wallet key, so we never delete on an unverifiable email.
  - **Signed request.** Add `buildLeaveMessage`/`parseLeaveMessage` to
    `core/points/messages.ts`:
    `gleam-points:leave:v1:<address>:<unixSeconds>`, signed with
    `signMessage` by the wallet's RSA key, like register. Naming the
    address in the payload binds the signature to that wallet.
  - **Server: `POST /leave`** (`apps/points-api/src/leave.ts`). Body
    `{ owner, message, signature }`. Verify the signature and freshness,
    and check `addressFromOwner(owner)` equals the message's address. In
    one transaction:
    - Delete the wallet's `snapshots` and `points` rows, then its
      `wallets` row.
    - Delete its device from `devices` if no other wallet still uses it.
    - Leaving an unknown address returns 200, so a retry after a lost
      response is safe.
  - **Keep referees whole.** Today a referee's +10% depends on
    `referred_by` pointing at a live row, so deleting a referrer would
    silently cut its referees' bonus.
    - New migration `002_leave.sql` adds `wallets.was_referred boolean
      NOT NULL DEFAULT false`, backfilled from `referred_by IS NOT NULL`.
    - The same migration changes `wallets.referred_by` to `ON DELETE SET
      NULL`, and `snapshots`/`points` → `wallets` to `ON DELETE CASCADE`.
    - Switch the referee bonus in `snapshot.ts` and `computeDailyPoints`
      input to `was_referred`, and `score.ts`'s `referred` with it.
      `referredBy` still drives the referrer bonus, which simply stops.
  - **Snapshot race.** `runSnapshot` reads wallets, then reads balances
    for minutes, then inserts. A wallet deleted in between would break
    the insert's foreign key and fail the whole day. Make the
    `snapshots`/`points` inserts join against `wallets` so a deleted
    address is skipped, and test it: delete between the read and the
    write.
  - **Extension.**
    - `PointsHandler.leave({ walletId })` signs and posts, then removes
      the wallet from `local:points:memberships`.
    - When no memberships remain, set `points:device.registered = false`
      to stop heartbeats.
    - Keep the device key: it carries no data once the server forgets
      it, and a later join reuses it.
    - Add `leavePoints` to `ProtocolMap` and the background dispatcher.
    - Points screen: a quiet "Leave Gleam Points" link at the bottom.
      Its confirm step reads "You'll lose your N points and your invite
      link will stop working. This can't be undone." The wallet must be
      unlocked.
  - **Site.**
    - `privacy.html#points` already describes "Leave Gleam Points" and
      an email fallback for a wallet whose install is gone. Honour the
      fallback only for a request signed with that wallet (e.g. a
      `signMessage` from any wallet, which we verify by hand), and
      check the page still matches what shipped.
    - Note that Railway's database backups keep deleted rows until they
      expire, and say how long that is.
  - **Tests.**
    - Server: rows gone, device removed only with its last wallet, a
      referee keeps its +10% after its referrer leaves, forged/stale/
      mismatched-address rejected, leave twice → 200, the snapshot race.
    - Extension: handler signs correctly and clears state, the
      heartbeat stops after the last wallet leaves, the confirm flow.
  - ❓ **Decisions before starting:**
    1. **Rejoining after leaving.** It's allowed, as a new wallet with a
       new invite code. Should it be able to use an invite code again?
       Deleting the device lets the "first wallet on this install" rule
       pass a second time. Blocking it means keeping a tombstone (e.g. a
       SHA-256 of the address), which is a small data-retention
       exception the privacy page would have to state.
    2. **Abuse review vs. deletion.** Leaving erases the evidence the
       pre-airdrop review would use. Accept that (leaving forfeits all
       points anyway), or delay hard deletion by N days?
    3. **Retention for uninstalls.** A wallet whose install never checks
       in again keeps its rows forever. Purge wallets with no heartbeat
       for, say, 12 months, and say so in the privacy page?

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
