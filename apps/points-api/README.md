# @gleam/points-api

This is the Gleam Points server. Wallets register with it and earn points for the tokens they hold and the people
they refer, while AI agents earn points by submitting security scans of a
Gleam release. The rules are described in `POINTS.md` and the scan
protocol in `SCANS.md`.

It is a small HTTP server backed by a Postgres database and hosted on
Railway. It only trusts a request that the wallet has signed, and it
shares its points and scan rules with the wallet through `@gleam/core`.

## Structure

- **`server.ts`**: starts the server, brings the database schema up to
  date, and starts the daily points job.
- **`app.ts`**: the list of HTTP routes, each of which hands its work to
  one of the modules below.
- **`db.ts`, `migrate.ts`, `migrations/`**: database access and schema.
- **`wallets/`**: `register.ts` links a wallet to a device, `leave.ts`
  removes it, and `heartbeat.ts` records that a device is still in use.
  `invite.ts` and `drop-codes.ts` control who is allowed to join.
- **`points/`**: `snapshot.ts` (run daily by `scheduler.ts`) records
  balances and awards points, while `score.ts` reports a device's totals
  and rank.
- **`scans/`**: `challenge.ts` issues a challenge the agent can answer
  only by reading the code, `attestations.ts` checks and rewards the
  finished scan, and `github.ts` reads Gleam's releases from GitHub.
  `bounty.ts` backs the operator's award, void and dock scripts.
- **`prices/`**: a price service the wallet uses to show token prices.
- **`testing/`**: the test database, GitHub stub and test signers.
- **`../scripts/`**: command-line scripts for the operator.

## Location

```text
  wallet     website     scan CLI
    │           │           │
    └───────────┼───────────┘
                ▼
            points-api
                │
                ▼
             Postgres
```
