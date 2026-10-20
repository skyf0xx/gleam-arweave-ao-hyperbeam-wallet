# @gleam/points-api

The Gleam Points server: a Hono HTTP API, backed by Postgres. It lets a
wallet register a device key and earn holding/referral points from
daily balance snapshots, and lets AI agents submit signed security-scan
attestations for points. It runs standalone on Railway via `tsx`,
outside the extension entirely — the extension is just one of its
callers. Full domain spec in root `POINTS.md`; the scan protocol in
`SCANS.md`.

Every endpoint re-verifies a wallet's signature itself, using
`@gleam/core/points`'s wire formats. The server never trusts an origin
or a prior session: a dropped response must be safely retryable, and a
request may come from the extension, a static page, or the `pnpm scan`
CLI.

## Components

- [`server.ts`](#serverts) — process entrypoint
- [`app.ts`](#appts) — the Hono route table
- [`db.ts`](#dbts) — the Postgres abstraction and its test double
- [`migrate.ts`](#migratets--migrations) — schema migrations
- [`register.ts`](#registerts--leavets) / [`leave.ts`](#registerts--leavets) — wallet-device binding
- [`heartbeat.ts`](#heartbeatts) — device liveness
- [`invite.ts`](#invitets--drop-codests) / [`drop-codes.ts`](#invitets--drop-codests) — Phase 1 invite gating
- [`snapshot.ts`](#snapshotts--schedulerts) / [`scheduler.ts`](#snapshotts--schedulerts) — daily points crediting
- [`score.ts`](#scorets) — the per-device points read
- [`scan-challenge.ts`](#scan-challengets--attestationsts) / [`attestations.ts`](#scan-challengets--attestationsts) — the scan protocol
- [`github.ts`](#githubts) — the GitHub release/file reader
- [`prices.ts`](#pricests) — the CoinGecko/CoinPaprika price proxy
- [`bounty.ts`](#bountyts--funnelts) / [`funnel.ts`](#bountyts--funnelts) — operator CLI scripts

### server.ts

Boots the process: reads config, runs pending migrations, starts the
Hono app under `@hono/node-server`, and starts the snapshot scheduler.
Owns the only `pg.Pool` in the process.

### app.ts

`createApp(deps)` builds the Hono route table from injected
dependencies (`db`, `github`, `now`, `pointsPhase`) rather than reading
globals, so tests build a fresh app per case.

Routes split into two groups by caller:

- **Extension-only** — `/register`, `/heartbeat`, `/leave`, `/me`,
  `/invite/redeem`. A CORS allowlist restricts these to
  `chrome-extension://` origins (any extension id, so unpacked dev
  builds work). Every request is still checked on its own signature,
  never trusted by origin.
- **Extension-only** also covers the price proxy, `GET /prices?ids=` and
  `GET /prices/history?id=&range=`.
- **Open CORS** — `/stats`, `/invite/check`, `/scan/challenge`,
  `/scan/rewards`, `/attestations*`. These are read by static pages (`invite.html`,
  `scan.html`, `scan-results.html`) on other origins, or by the `pnpm scan` CLI with no
  origin at all.

Each route has its own `RateLimiter` (per-IP, some also per-device), and
a 16KB body limit, except the two attestation routes (160KB, since a
scan report can run up to 20,000 characters).

Every handler is a thin shim: parse and validate the body with a
`parse*` function from the matching module (it returns `null` on
anything malformed), call that module's function, then map its outcome
to an HTTP response. No business logic lives in `app.ts` itself.

### prices.ts

The price proxy for users whose network blocks CoinGecko or CoinPaprika.
Only ids in core's `DEFAULT_TOKEN_REGISTRY` are accepted. Each lookup
tries CoinGecko, then CoinPaprika, and answers `null` / an empty series
if both fail. Results are cached in memory (spot 60 s, history 5 min,
failures 15 s) and concurrent misses share one upstream call, so many
users don't multiply provider requests.

### db.ts

`Db`/`Queryable` interfaces wrap the slice of Postgres the app uses:
plain queries, `transaction`, and `withLock` (a Postgres advisory lock,
released on the same connection that took it — required since advisory
locks are session-scoped).

- **`dbFromPool`** — wraps a real `pg.Pool`, for production.
- **`dbFromPglite`** — wraps PGlite (real Postgres compiled to WASM),
  so tests run the same SQL against the same engine without a Postgres
  server.

### migrate.ts / migrations/

`migrate(db)` applies every `migrations/NNN_*.sql` file not yet
recorded in `schema_migrations`, in order, each in its own transaction,
on every boot. Applied files are never edited — only superseded by a
new numbered file.

### register.ts / leave.ts

A wallet proves ownership of its Arweave address (`verifyPointsProof`:
a signed message, or for a hardware wallet, a signed zero-value
transaction) and binds to this install's device key.

- Re-registering an already-known wallet just moves it to a new device
  (a reinstall) and keeps its invite code and referrer.
- During Phase 1, a brand-new wallet needs an install that already
  redeemed an invite or holds a wallet. Registering itself also counts
  as a heartbeat.
- `leave.ts` deletes a wallet and its snapshots/points (cascading), but
  keeps its past attestations. Those are signed public records, and
  deleting them would let a wallet farm scan rewards by leaving and
  rejoining.

### heartbeat.ts

- **`authenticateDevice`** — verifies a device-signed message against
  the stored device public key, shared by `/heartbeat` and `/me`.
- **`recordHeartbeat`** — stamps `last_heartbeat_at`. This gates both
  snapshot eligibility and scan eligibility. A wallet counts as "live",
  and can earn points or submit an attestation, only if it has a
  heartbeat within the last 3 days.

### invite.ts / drop-codes.ts

Phase-1 invite gating. A code is either a wallet's own **member** code
(limited seats, refilled once the let-in install registers) or an
operator-issued **drop** code (`drop-codes.ts`, optionally seat-limited
or unlimited, with a CLI to mint one).

`redeemInviteCode` is idempotent per device: redeeming twice just
confirms, never double-spends a seat. Races are resolved with row locks
(`FOR NO KEY UPDATE` on the wallet, chosen so it doesn't block the `KEY
SHARE` lock a referred registration takes).

### snapshot.ts / scheduler.ts

`runSnapshot` takes one UTC day's balance snapshot of every wallet
(skipping non-live ones), computes points via `@gleam/core/points`'
`computeDailyPoints`, and records snapshot/points/bounty-pool rows in
one transaction. That transaction is guarded so a day can only ever be
credited once.

`scheduler.ts` runs this under a Postgres advisory lock on boot and
every 10 minutes after, so a missed midnight (restart, deploy) is
picked up by the next tick rather than skipped.

### score.ts

`scoresForDevice` recomputes a device's wallets' point totals, referral
counts, rank, and percentile on every read — it isn't cached. That's
simple today; the in-code comment calls out turning it into a running
total once it shows up in latency.

### scan-challenge.ts / attestations.ts

The scan-attestation protocol's server half (see `@gleam/core/scan` for
the shared tokenizing/validation logic the client and server both use).

- **`issueChallenge`** — draws a deterministic set of
  security-relevant functions from the latest release's surface and
  stores it, single-use and time-limited.
- **`attestations.ts`** — runs the full check sequence from
  `SCANS.md`: release/commit match, challenge validity, answer
  correctness, wallet liveness, one attestation per wallet per release.
  It runs all of this under a per-release advisory lock, so two scans
  can't both claim the same paid reward slot.

The first `PAID_SCANS_PER_RELEASE` (20) correct attestations per release
earn points (1/1000 of the previous day's total holding points); later
ones are still recorded, just unpaid. `/attestations/check` runs the
same validation as a dry run, without a signature, so an agent can
self-correct before asking the user to sign.

`scanRewardBasis` computes that reward and the day it comes from.
`/attestations` credits it, and `/scan/rewards` publishes it with the
bounty pool's balance (`poolBalance` from `bounty.ts`), so `scan.html`
shows exactly what a scan is paid.

### github.ts

The one place the server talks to GitHub: it finds the latest release
and its security-surface files. It's wrapped in a `Memo` cache with
three rules tuned for GitHub's unauthenticated 60-requests-an-hour
quota.

- Concurrent requests for the same key share one fetch.
- Failures are remembered briefly, to avoid hammering a down API.
- A recently-expired answer is served stale while GitHub is
  unreachable, rather than failing outright.

### bounty.ts / funnel.ts

Operator-run CLI scripts, not server routes (invoked via `pnpm
scan-award`/`scan-void`/`funnel`/`drop-code`).

- **`bounty.ts`** — pays out a severity-weighted share of the bounty
  pool for a reviewed scan finding.
- **`funnel.ts`** — reports invite/drop-code redemption and retention
  stats.

## Data flow

- The extension signs a request with the wallet key
  (`@gleam/core/points` message formats) and sends it over
  CORS-restricted routes. `register`/`leave`/`invite.ts` verify the
  signature, never the origin.
- A separate device key (P-256, generated per install) authenticates
  `/heartbeat` and `/me`. That decouples "is this wallet live" from
  "did this wallet just sign a points action."
- The scan flow is unauthenticated until submission. `scan.html`/the
  CLI read a challenge anonymously and validate their own answer
  locally against `@gleam/core/scan`. Only the final `/attestations`
  POST needs a wallet signature, checked against the same challenge
  and release state the dry run already confirmed.
