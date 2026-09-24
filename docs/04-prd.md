# PRD — §3 Glossary and §4 Features only

Compressed intake (authored core). Mined from the `ao-wallet` sibling
repo's `GLEAM.md`, `CLAUDE.md`. Sections beyond
§3/§4 are out of scope for this file per compressed-intake's authored-core
rule — Phase 1 mining reads only these two.

## §3 Glossary

- **Wallet** — a stored key record: `id`, `address`, `name`, `method`
  (`jwk` for Phase 1; `ethereum`, `ledger` are Phase 2), `publicKey`,
  timestamps, `encryptedKeyfile` envelope. Ledger wallets store no key
  material, only address/pubkey. A browser profile can hold multiple
  Wallets.
- **Vault** — the encryption envelope wrapping a Wallet's key material:
  PBKDF2-HMAC-SHA256 (600,000 iterations) deriving a non-extractable
  AES-256-GCM key, random salt/IV, record-bound AAD
  (`gleam:v1:<walletId>:<address>`). One Vault per Wallet.
- **Session** — the unlocked state of the extension: `unlockedAt`,
  `lastActivityAt`, an optional auto-lock timeout (never/immediate/5min/
  1hr/4hr, default never). Global, not per-Wallet — every Wallet shares
  the one Vault password, so unlocking with it unlocks every stored
  Wallet at once. A Session references zero or more unlocked Wallets.
- **Grant** — a per-origin permission record created when a dApp calls
  `connect()`: origin, requested permission scopes (address access, sign,
  dispatch, etc.), `expiresAt` and `budget` (nullable in Phase 1, reserved
  for Phase 2 budgeted grants). A Wallet has zero or more Grants, one per
  connected origin. Revoking a Grant ends all access it covered.
- **ActivityEntry** — one row in the local action log (optimistic,
  written on submit) or the merged gateway GraphQL result: tx id, type
  (send/receive/upload), status (pending/confirmed/failed), tags. Belongs
  to a Wallet's address (as owner or recipient).
- **Balance** — AR balance (Winston units, atomic integer strings) or an
  AO token balance (via HyperBEAM `process@1.0` read) for a given address.
  Not persisted — read live, cached briefly.
- **TransferDraft** — an in-progress send: recipient address, token,
  amount, computed fee. Escalates to "first-seen address" tier if no prior
  ActivityEntry exists for that recipient.
- **UploadDraft** — an in-progress upload: file/text/JSON payload, tags
  (byte-capped ~4096 bytes), optional UDL license tag. Runs a pre-upload
  secret scan (rejects payloads resembling a private key/JWK/PEM block)
  before submission to a bundler.
- **ApprovalRequest** — a pending action awaiting user sign-off in its own
  window: a Grant request (connection) or a signing request (sign/
  dispatch/signDataItem/batchSignDataItem/encrypt/decrypt). Each carries a
  `requestId`, references the originating origin, and a decoded-intent
  preview.
- **Provider surface** — the injected `window.arweaveWallet` object: the
  ArConnect-compatible method surface (`connect, disconnect,
  getPermissions, getActiveAddress, getAllAddresses, getActivePublicKey,
  getWalletNames, getArweaveConfig, getBalances, sign, dispatch, encrypt,
  decrypt, signature, signMessage, privateHash, verifyMessage,
  signDataItem, batchSignDataItem`). A page-originated message can only
  ever reach this method set — never the key-management methods
  (`createWallet`, `importWallet`, `exportWallet`).
- **NetworkSettings** — the configured Arweave gateway and list of
  AO-Core/HyperBEAM peer URLs (add/remove, per-peer enable toggle, active
  endpoint selection).

Relationships: Wallet 1—1 Vault; Wallet 1—N Grant; Wallet 1—N
ActivityEntry (via address); Wallet 1—N TransferDraft/UploadDraft
(ephemeral, not persisted long-term); Grant 1—N ApprovalRequest
(signing requests reference the Grant that authorized the origin);
Session 0—N Wallet (which are currently unlocked).

## §4 Features

Each Feature below is Phase 1 scope only (per `CLAUDE.md`'s explicit
phasing) — the build this project executes now. Phase 2+ items
(Ethereum keys, Ledger, ArNS, uniques, auto-sign/gatekeeper,
import/export settings, fullscreen surface, passkeys, full simulation,
budgeted grants) are named in the sibling repo's docs as later scope and
are **not** mined into intents here.

### Feature: Wallet creation & import
Create a new RSA-JWK Wallet (generate keyfile, prompt backup) or import an
existing JWK keyfile, gated behind setting a Vault password.
- FR — Consequences (testable):
  - Password must be ≥10 characters and rejected if it matches a
    common/breached-password blocklist check.
  - A generated JWK is immediately encrypted into the Vault envelope
    before touching any storage; plaintext key material is never
    persisted.
  - An invalid/malformed imported keyfile is rejected with a specific
    reason ("That file isn't a valid Arweave keyfile"), not a generic
    error.
  - Backup/download of the keyfile is offered at creation time, explicit
    and skippable, never forced or hidden.
- Rule: plaintext key-material buffers are zeroized (`.fill(0)`) in a
  `finally` block after both encrypt and decrypt, including error paths.

### Feature: Vault lock/unlock session
Global unlock (not per-wallet) gating access to all stored Wallets, with
configurable auto-lock.
- FR — Consequences (testable):
  - A single Vault password unlocks every stored Wallet at once: the
    first Wallet created sets it, and every later Wallet must reuse it.
  - Default auto-lock timeout is "never"; manual "Lock now" always
    available and immediately clears unlocked-session state regardless of
    timeout config.
  - The unlock screen shows no per-wallet identity (avatar/name/address).
  - "Forgot password" leads to an explicit, plainly-worded destructive
    reset (wipes all locally stored vaults) — never a silent delete.
- Rule: unlocked-session metadata lives in memory-only storage
  (`chrome.storage.session`), never written to disk; a non-extractable
  `CryptoKey` cannot itself be persisted there.

### Feature: AR balance & main screen
Show the AR balance for the active address and a portfolio view.
- FR — Consequences (testable):
  - Balance is read via `GET {gateway}/wallet/{address}/balance` and
    handled as a Winston atomic-integer string throughout — never
    converted to a floating-point number at any layer.

### Feature: Send AR
Compose, review, and submit an AR transfer.
- FR — Consequences (testable):
  - The review screen always shows the full recipient address, never
    truncated.
  - A TransferDraft to an address with no prior ActivityEntry escalates
    the review screen to first-seen-address (Irreversible) tier framing.
  - Fee is computed and shown only at the review stage, not during
    composition.
  - Submission writes an optimistic ActivityEntry immediately, before
    gateway confirmation.

### Feature: Receive AR
Show the active address and a QR code for receiving funds.
- FR — Consequences (testable):
  - The full address is always shown with a visible copy affordance,
    never truncated.

### Feature: AO token balances
Read AO token balances for the active address via HyperBEAM.
- FR — Consequences (testable):
  - Balance is read via the HyperBEAM `process@1.0` compute path:
    `GET /{processId}~process@1.0/compute/balances/{address}` (the `now/`
    path variant is a noted open unknown to verify against a live node
    before this feature is built, not a Phase-1-blocking ambiguity for
    intake).
  - No legacy MU/CU dry-run fallback in this phase.

### Feature: Activity feed
Merge a local action log with one gateway GraphQL query into a unified
feed.
- FR — Consequences (testable):
  - Feed is the union of (a) every wallet-initiated ActivityEntry
    (optimistic on submit) and (b) one gateway GraphQL `transactions`
    query by owner and by recipient, most-recent-N, no multi-gateway
    aggregation.
  - The list view may show truncated addresses; there is no separate
    transaction detail screen — a row's explorer link is the detail
    view, opening the full (untruncated) tx id and tags on the gateway's
    own site.

### Feature: Upload content
Compose and submit a tagged Arweave transaction (file/text/JSON) via a
bundler.
- FR — Consequences (testable):
  - Tag byte size is capped at ~4096 bytes, enforced live during
    composition, not only on submit.
  - A pre-upload secret scan rejects/flags payloads that look like a
    private key/JWK/PEM block before submission, stating the specific
    match type.
  - An optional UDL license tag can be attached.

### Feature: Injected provider & connection approval
Inject `window.arweaveWallet` (ArConnect-compatible surface) into pages,
bridge requests through content script → background → approval popup.
- FR — Consequences (testable):
  - The provider is injected via a removable `<script src>` tag
    (`injectScript`, `keepInDom: false`) at `document_start`, top frame
    only (`all_frames: false`).
  - A page-originated message can only reach `PROVIDER_METHODS` — never
    `KEY_METHODS` (`createWallet`, `importWallet`, `exportWallet`,
    `addLedgerWallet`) or `APPROVAL_METHODS`. This boundary is enforced at
    a single dispatcher choke point.
  - `connect()` requests show the origin and requested permission scopes
    before creating a Grant; approval opens as its own
    `chrome.windows.create` popup window, never inline in the extension
    popup (a popup closes on focus loss, which would silently drop the
    request).
  - Gleam always owns `window.arweaveWallet`, even when another Arweave
    wallet extension (Wander) is installed. There is no setting for it.

### Feature: Signing approval
Every sign/dispatch/signDataItem/batchSignDataItem request from a
connected dApp routes to a dedicated approval screen.
- FR — Consequences (testable):
  - Shows recipient, amount, fee, a decoded-data preview, tags, and a
    SHA-256 hash of the exact signing payload with its own copy
    affordance, before the user can approve.
  - Opens as its own window, never inline in the popup.
  - If no Wallet exists yet when a signing request arrives, the approval
    window switches to onboarding in place and returns to the pending
    request afterward, rather than rejecting the dApp.

### Feature: Connected apps management
List every origin with a stored Grant and allow reviewing or revoking it.
- FR — Consequences (testable):
  - Revoking a Grant ends all access it covered — a revoked origin must
    be re-approved via a fresh `connect()` flow before any further
    provider call succeeds.
  - Each row shows scope and expiry inline, not hidden behind a detail
    tap.

### Feature: Network/peer settings
Editable list of AO-Core/HyperBEAM peer URLs and the Arweave gateway.
- FR — Consequences (testable):
  - Peers can be added/removed with a per-peer enable toggle; applying a
    change switches the active endpoint(s) used by subsequent reads.

### Feature: Wallet management (switch/rename/remove)
Manage multiple stored Wallets.
- FR — Consequences (testable):
  - Removing a Wallet with no confirmed backup warns explicitly that
    access will be lost permanently before proceeding.
  - Renaming only changes local metadata, never re-derives or re-encrypts
    key material.

## Cross-cutting NFRs (project-wide, not owned by a single Feature)

- Storage is treated as untrusted input: every record read back is
  re-validated (ports range-checked, permissions filtered against an
  allowlist, malformed records dropped) on every load.
- `core` package logic (vault, keys, signing, arweave/ao clients, pricing,
  activity, policy, models) has zero `chrome.*`/`window`/`document`
  dependency — enforced via an ESLint `no-restricted-imports` rule — so it
  remains portable to a future non-extension host.
- Container queries (not viewport breakpoints) drive responsive layout,
  since the same component mounts in popup/sidepanel/approval contexts
  with independent sizing.
- Both light and dark themes ship together from the first screen, defined
  as CSS custom properties, never color-defined only inside a media query.
