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
- **Wallets**: `register.ts` links a wallet to a device, `leave.ts`
  removes it, and `heartbeat.ts` records that a device is still in use.
- **Invites**: `invite.ts` and `drop-codes.ts` control who is allowed to
  join.
- **Points**: `snapshot.ts` and `scheduler.ts` record balances and award
  points once a day, while `score.ts` reports a device's totals and rank.
- **Scans**: `scan-challenge.ts` issues a challenge the agent can answer
  only by reading the code, and `attestations.ts` checks and rewards the
  finished scan.
- **`github.ts`**: reads Gleam's releases from GitHub for the scans.
- **`prices.ts`**: a price service the wallet uses to show token prices.
- **`bounty.ts`, `funnel.ts`**: command-line scripts for the operator.

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
