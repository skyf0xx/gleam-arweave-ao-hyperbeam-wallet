# Gleam Points

Points reward wallets that keep their AR and AO in Gleam, and reward
inviting others. Their purpose is install growth. A future airdrop is
distributed in proportion to each wallet's share of all points.

## Rules

- **Holding.** Once a day the server snapshots every eligible wallet's
  native AR balance and AO token balance. Each whole AR or AO earns 1
  point per day, so 1 AR and 1 AO are worth the same. wAR, LP positions
  and staked tokens don't count.
- **Liveness.** A wallet is eligible only if its install sent a heartbeat
  in the 3 days before the snapshot.
- **Referrals.** A wallet that joined with an invite code earns +10% on
  its own holding points. The wallet that invited it earns 10% of that
  wallet's holding points. Referral points never earn further referral
  points, so referrals pay out one level only. There are no caps. A
  referrer that isn't live that day earns no referrer bonus. The
  referee's own bonus doesn't depend on its referrer being live.
- **Airdrop share** = a wallet's points ÷ all points. Points carry no
  promised value or conversion ratio. Before any distribution they are
  subject to an eligibility review, which can exclude abusive wallets.

```
base(w)  = (AR_atomic(w) + AO_atomic(w))          if w is live, else 0
daily(w) = base(w) × (1.1 if w was referred else 1)
         + Σ 0.1 × base(r)   for each referee r of w
```

Points are stored as atomic integers with 12 decimals, the same unit as
AR and AO, so `base` needs no conversion. Use integer arithmetic only:
`×1.1` is `× 11 / 10`.

## Identity

- **Device key.** Each install generates an ECDSA P-256 key pair once.
  It is stored as a non-extractable `CryptoKey` in IndexedDB. It signs
  heartbeats and score reads, and it never needs the vault unlocked.
- **Registration** is opt-in and per wallet. The wallet signs, with
  `signMessage` (RSA-PSS, Wander-compatible):
  `gleam-points:register:v1:<deviceKeyThumbprint>:<inviteCode|->:<unixSeconds>`.
  The server checks the signature against the submitted owner modulus
  and derives the address as `b64url(sha256(n))`. One install can
  register several wallets. An invite code applies only to the first
  wallet that install registers.
- **Heartbeat.** About once a day, from the background alarm, the device
  key signs `gleam-points:heartbeat:v1:<unixSeconds>`. The server
  rejects timestamps more than 10 minutes old and stores the latest
  heartbeat per device.
- **Score reads** are signed by the device key over
  `gleam-points:me:v1:<unixSeconds>`, and the server answers only for
  wallets registered to that device. No leaderboard is public.

Invite codes are 6–16 characters of `A–Z0–9`. Input is trimmed and
uppercased before it is checked. Every signed payload starts with the `gleam-points:` prefix, so none of
them can be replayed as a transaction or a dApp message.

## Attribution

A Chrome Web Store link can't carry a referral code into the installed
extension, so the code travels through the site:

1. An invite link `https://<site>/invite?c=<code>` stores the code in
   `localStorage` and redirects to the Chrome Web Store listing.
2. On first install the extension already opens `welcome.html`. That page
   reads the code and sends it to the extension with
   `chrome.runtime.sendMessage(EXTENSION_ID, …)`. This requires
   `externally_connectable` for the site's origin.
3. The extension keeps the code until a wallet registers. A manual
   "Have an invite code?" field in the Points sheet is the fallback.

## Server

`apps/points-api` is a Hono app on Node, run with `tsx` so it imports
`@gleam/core`'s TypeScript source directly. It runs on Railway from
`apps/points-api/Dockerfile`, with Railway Postgres. Migrations in
`src/migrations/` apply on boot.

| Table | Columns |
| --- | --- |
| `devices` | `id`, `public_key_jwk`, `last_heartbeat_at` |
| `wallets` | `address`, `device_id`, `invite_code` (own, unique), `referred_by` (address, nullable), `registered_at` |
| `snapshots` | `day`, `address`, `ar_atomic`, `ao_atomic`, `live` |
| `points` | `day`, `address`, `holding_atomic`, `referee_bonus_atomic`, `referrer_bonus_atomic` |

| Endpoint | Purpose |
| --- | --- |
| `POST /register` | Bind a wallet to a device and apply an invite code. Returns the wallet's own invite code. |
| `POST /heartbeat` | Device liveness. |
| `POST /me` | Signed by the device key. Returns `settledAt` (when the latest snapshot completed) and, for each of the device's wallets: total points, the latest day's breakdown, "Top N%" among wallets with points, number of referees, and invite code. |

Requests are rate-limited per IP and per device.

**Daily snapshot.** An in-process scheduler checks every 10 minutes. If
today's UTC date has no `snapshot_runs` row, it takes a Postgres
advisory lock and runs. One pass reads every live wallet's balances
(bounded concurrency, retried), then writes `snapshots`, `points` and the
`snapshot_runs` row in one transaction. A restart or a second replica
can't double-run a day, and a missed run catches up on the next check.

## Extension

- **Header chip.** Shows total points. Between server updates it ticks up
  live using the wallet's current balances × the published rate. It shows
  "Join" for a wallet that hasn't registered.
- **Points sheet** (opened from the chip). Shows points, "Top N%", the
  invite link with a copy button, the number of friends who joined, the
  invite-code field and a "How points work" link. No new tab.
- **Placement.** Pure logic lives in `core/points/`: message builders
  and parsers, the device-key thumbprint, the daily formula and the
  local estimator. The points API uses the same module. Wire contracts live in
  `messaging`, the background work in `handlers/points.ts`, and the
  points API URL is a build-time constant.
