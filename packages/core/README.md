# @gleam/core

The wallet's pure domain logic: key custody and signing, Arweave and AO
network operations, activity merging, pricing, send-time safety checks,
Gleam Points, and the community security-scan protocol.

Nothing here imports `chrome.*`, WXT, or any browser API. Network
access comes in as an injected `fetchImpl`/URL. Browser/extension state
comes in through the interfaces in `ports/`. That boundary is what lets
this package also run inside the standalone `apps/points-api` server
and the `scripts/scan/` CLI, not just the extension.

`package.json`'s `exports` map enforces part of this:

- `./signer` is a named subpath into `signer/index.ts`.
- `./src/signer/*` is blocked outright, so nothing can reach into
  `signer/`'s internal files except through its curated barrel.
- Root `src/index.ts` re-exports `models`, `recipients`, most of
  `vault/`, `hardware/ledger`, `keys/*`, `ports` types, and `pricing`.
- It does not re-export `ao/`, most of `arweave/`, `activity/`,
  `points/`, `policy/`, or `scan/`. Callers reach those via the open
  `./src/*` subpath instead.

## Components

- [`models/`](#models) — shared types and constants
- [`ports/`](#ports) — interfaces into the browser/extension host
- [`signer/`](#signer) — key custody: password → unlocked key
- [`vault/`](#vault) — signing operations on an unlocked key
- [`keys/`](#keys) — stateless JWK and address helpers
- [`arweave/`](#arweave) — Arweave L1 balance, transfer, upload, GraphQL
- [`ao/`](#ao) — AO token balance, transfer, result polling
- [`hardware/ledger/`](#hardwareledger) — Ledger device signing
- [`activity/`](#activity) — merges local and gateway activity logs
- [`recipients/`](#recipients) — address-poisoning defense
- [`pricing/`](#pricing) — USD price and exchange-rate lookups with provider fallback
- [`policy/`](#policy) — upload/sign payload validation
- [`points/`](#points) — Gleam Points domain logic
- [`scan/`](#scan) — the community security-scan attestation protocol

### models/

Shared types and constants, with almost no logic. This is core's
largest directory, and the one nearly everything else depends on.

- **Wallet shapes** — `Wallet`, `WalletSummary`, `VaultEnvelope`.
- **Privilege tiers** — `PROVIDER_METHODS`/`APPROVAL_METHODS`/
  `KEY_METHODS` in `method-privileges.ts`.
- **Capabilities** — `WalletCapabilities` per wallet method.
- **Signing shapes** — the provider-signing request/result types
  `vault/signing.ts` operates on.

`packages/messaging` depends on `core/models` to type its RPC contract.
It never goes the other way.

### ports/

Interfaces by which core reaches the host environment. None of them
have an implementation in this package.

- `StoragePort`, `RuntimePort`, `ApprovalPresenterPort` (approval UI),
  `BadgePort`, `SessionKeyStorePort`, `DownloadPort`.

Each one's real implementation lives in `apps/extension/src/adapters/*`.
Core imports only the interface, never an adapter. The one exception is
`Keyring` (in `signer/`): it implements `SessionKeyStorePort` with a
plain in-memory `Map`. That's pure domain logic with no browser API, so
it lives in core instead of behind an adapter.

### signer/

Key custody. This is the only place a password becomes a decrypted key,
and the only place that key is held in memory.

- **`envelope.ts`** — encrypts and decrypts the vault envelope
  (Argon2id or legacy PBKDF2 → AES-256-GCM, AAD-bound to wallet id and
  address).
- **`keyring.ts`** — `Keyring` holds unlocked wallets as
  non-extractable `CryptoKey`s in memory. It never writes them to
  storage.
- **`keys.ts`** — turns a decrypted JWK or a live keyring entry into a
  `Signer` (the interface `vault/` defines).
- **`zeroize.ts`** — overwrites plaintext key bytes once an operation
  finishes.

`signer/` has exactly one non-type npm import anywhere in it —
`hash-wasm`, for Argon2id. That matches the project rule that it's
reached only through `@gleam/core/signer`.

### vault/

The operation layer built on top of an already-unlocked `Signer`.

- **`signing.ts`** — sign/dispatch/signDataItem/batchSignDataItem
  pipelines.
- **`encryption.ts`** — RSA-OAEP encrypt/decrypt for the provider
  surface.
- **`message-signing.ts`** — signMessage/verifyMessage, byte-compatible
  with Wander.
- **`password-policy.ts`** — minimum length plus a common-password
  blocklist.
- **`passkey.ts`** — wraps the vault password under a WebAuthn PRF
  output.
- **`signer.ts`** — defines the `Signer` interface itself. Every
  signing call site in core programs against this contract, regardless
  of whether it's backed by a keyfile, a live session, or (via the
  extension) a hardware device.

`signer/` and `vault/` layer one way:

- `signer/` produces `Signer` instances. It depends on
  `vault/signer.ts` only for that type.
- `vault/` never calls into `signer/`'s custody logic. It borrows only
  `zeroize`, to wipe the password it unwraps in `passkey.ts`.

In short: `signer/` is custody — get a password into an unlocked key,
safely. `vault/` is usage — given an unlocked key, perform the
operations the provider surface needs.

### keys/

Stateless, encryption-independent identity helpers.

- **`jwk.ts`** — generates and validates JWKs.
- **`address.ts`** — derives an Arweave address from a raw RSA modulus.
  It's deliberately free of arweave-js, so the standalone points server
  and hardware-wallet address derivation can reuse it.
- **`keyfile-filename.ts`** — sanitizes a wallet name into a safe
  download filename.

### arweave/

Arweave L1 operations.

- **`data-item.ts` and `transaction.ts`** — the two from-scratch
  signing primitives, for ANS-104 data items and format-2 transactions
  respectively. Both are built on raw bytes and WebCrypto rather than
  `@dha-team/arbundles`, because arbundles' browser build breaks
  raw-JWK signing in Chrome.
- **`rsa-pss.ts`** — the shared RSA-PSS/SHA-256 primitives both build
  on.
- **`transfer.ts`** — handles AR value transfers.
- **`upload.ts`** — posts ANS-104 data items to a bundler.
- **`graphql.ts`, `gateway.ts`, `balance.ts`, `token-metadata.ts`** —
  cover reads.

`upload.ts` and `transaction.ts` aren't layered. They handle different
payload kinds — bundled data items versus base-layer transactions — and
neither calls the other.

### ao/

AO token operations. A token is one of two kinds, read from its spawn
tags (`arweave/token-metadata.ts`'s `transport`): `"l1"` for a
HyperBEAM-native process on `arweave-scheduler@1.0`, `"mu"` for a
legacynet process.

- **`balance.ts`** — `getTokenBalance` reads one HyperBEAM compute-path
  balance. `readTokenBalance` routes by kind: an `"l1"` token is read
  from the gateway's HyperBEAM node, then the peer; an `"mu"` token from
  the peer, then a CU dry-run (`legacy-token.ts`).
- **`legacy-token.ts`** — `Balance` and `Info` dry-runs against the
  legacynet Compute Unit, for legacy tokens a peer won't serve.
- **`transfer.ts`** — builds and signs an ANS-104 `Transfer` message
  (via `arweave/data-item.ts`) and POSTs it to the legacynet Messenger
  Unit, for `"mu"` tokens. This deliberately skips `@permaweb/aoconnect`,
  for the same Chrome-signing reason `arweave/` avoids arbundles.
- **`l1-transfer.ts`** — the zero-AR L1 transaction an `"l1"` token
  takes a transfer as (lowercase `action`/`recipient`/`quantity` tags).
  `collectible-transfer.ts` is its quantity-1 case.
- **`result.ts`** — a separate, later poll against the Compute Unit for
  a legacy transfer's execution outcome. Submitting only proves the MU
  scheduled the message, not that the process accepted it.
- **`asset-scan.ts`** — bounded gateway scans for the processes an
  address has touched, and `classifyAsset` (fungible or unique, by
  spawn tags). Shared by:
  - **`collectibles.ts`** — the NFTs an address holds.
  - **`token-discovery.ts`** — the fungible tokens an address has
    history with: L1 transfers to it, its market orders, initial
    holdings, and MU-signed `Credit-Notice`s. Every result is
    unverified: its ticker, name and balance are the process's own
    claims. Balances are the caller's to read.

Callers chain a legacy send: submit, get a message id, later poll for
the outcome, then feed that into `activity/merge.ts`. An L1 send settles
through the gateway index like an AR send.

### hardware/ledger/

Drives a Ledger device's Arweave app over APDUs.

- **`client.ts`** — gets the address/public key and signs transactions
  or data items. Data items need the "Permaweb" app fork; message
  signing isn't supported on hardware. Before trusting a signature, it
  recomputes the expected deep hash via `arweave/transaction.ts`/
  `arweave/data-item.ts` and checks it against what the device reports.
  A serialization drift fails loudly instead of signing the wrong
  bytes.
- **`serialize.ts`** — encodes the on-device wire format.
- **`transport.ts`** — defines the `LedgerTransport` interface the
  extension's WebHID adapter implements.

### activity/

`merge.ts` combines the local optimistic send/receive log with one
gateway GraphQL result into one deduplicated `ActivityPage`. The
gateway's entry wins once confirmed; otherwise the local status does.
It also re-tags a gateway-confirmed AO transfer as failed when the
process itself rejected it — gateway indexing alone can't tell that
apart from a successful transfer.

### recipients/

`assess.ts` flags a first-time recipient and detects lookalike
addresses (one sharing a known counterparty's first or last characters,
or most of its characters in place, without being it) against both
activity history and saved contacts. Even a received-only address is
checked, since a poisoner's dust often arrives as an incoming transfer.

`memorable-address.ts` cuts an address into 4-character chunks in two
rows (7 · 4) and picks the chunks to emphasise: the first, the last, and two
middle ones chosen per user from HMAC-SHA256 of their security phrase, so
a ground lookalike can't know which middle chunks the user checks.

### pricing/

USD price lookups for AR, AO, and registered tokens, plus USD exchange
rates for the display currencies in `models/display.ts`. The extension
never calls a price provider: `spot.ts`, `historical.ts` and `fx.ts` read
the Gleam server's `/prices`, `/prices/history` and `/prices/fx` proxy,
which falls from CoinGecko to CoinPaprika and caches. A lookup reports `null` (or an empty series)
rather than a fabricated `0` when the server or both providers fail.
`portfolio.ts` turns price series into portfolio-value estimates over time.
`impersonation.ts` says whether a token found on-chain presents itself as
a registry token (lookalike tickers and names such as `A0`, `wAR`, or
Cyrillic `АО`), so discovery can drop it.

### policy/

Payload-level guard rails applied before a request goes out.

- **`secret-scan.ts`** — heuristically flags likely key material in an
  upload: PEM blocks, JWK-shaped JSON with a private `d` field, long
  bare-base64 blobs.
- **`tag-size.ts`** — enforces ANS-104's tag-byte cap.

### points/

Gleam Points domain logic (full spec in root `POINTS.md`).

- **`curve.ts` and `formula.ts`** — compute daily points from wallet
  balances: a linear-then-square-root curve, split per wallet, with
  referral bonuses.
- **`identity.ts`** — handles the device key (P-256 ECDSA) used to sign
  points payloads.
- **`messages.ts`** — defines the exact signed wire format for every
  points action, kept byte-symmetric with the server.
- **`ownership.ts`** — lets a hardware wallet prove address ownership
  (which it can't do via `signMessage`) by signing an unminable
  zero-value transaction instead.

This is the one subdirectory explicitly designed to be imported by
`apps/points-api`, a standalone server outside the extension.

### scan/

The community security-scan attestation protocol (full spec in root
`SCANS.md`). An AI agent scans a tagged release and submits a signed
attestation to earn Gleam Points. Because that's an honor system, the
server issues a "challenge": a few specific, security-relevant functions
the agent must cite a real guarding line from. A plausible-looking but
unread attestation fails to verify.

- **`lexer.ts` / `functions.ts`** — tokenize TS/TSX by hand, with no
  TypeScript compiler dependency, to find functions and detect which
  ones visibly guard something (an `if`/`throw`/`switch`).
- **`surface.ts`** — reads `security/surface.txt` to find the in-scope
  challenge pool.
- **`challenge.ts`** — deterministically draws a challenge from a seed.
- **`canonical.ts`** — hashes canonical JSON for the attestation id.
- **`attestation.ts`** — validates the attestation shape.
- **`answer.ts`** — checks each cited line actually falls inside the
  right function and holds real code.
- **`payload.ts`** — encodes an attestation into a URL fragment, so it
  reaches the extension's approval window without a server round-trip.

This directory is fully dependency-free, so both `scripts/scan/`'s CLI
and `apps/points-api` can reuse it unchanged.

## Data flow

A typical signed send works like this:

1. The extension unlocks the vault. `signer/envelope.ts` decrypts a
   JWK, and `signer/keys.ts` turns it into a `Signer`, held by
   `signer/keyring.ts`.
2. A transfer handler passes that `Signer` into `arweave/transfer.ts`
   or `ao/transfer.ts`.
3. That module builds and signs a transaction or data item via
   `arweave/transaction.ts`/`arweave/data-item.ts` and submits it over
   the network.
4. The result feeds `activity/merge.ts` (and, for AO, `ao/result.ts`'s
   later outcome poll) to produce the activity feed the UI reads.

Throughout, core never touches `chrome.storage` or any browser API
directly. The extension's handlers pass in `ports/` implementations and
read results back out.
