# @gleam/core

This package is the wallet's domain layer. It manages keys and signing,
talks to Arweave and AO, and holds the rules behind features such as the
activity feed, prices, recipient warnings, Gleam Points and security
scans. It has no UI and knows nothing about Chrome or phones.

It follows the ports-and-adapters pattern: core defines interfaces
(ports) for what it needs from outside, such as storage, and receives
`fetch` and URLs as parameters. Whoever runs it supplies the
implementations, which is why the same code runs unchanged in both
wallet apps, the points server and the scan CLI.

## Structure

### Keys and signing

- **`signer/`**: key custody. It turns the user's password into an
  unlocked key and keeps that key in memory while the wallet is open.
- **`vault/`**: everything the wallet does with an unlocked key, including
  signing transactions and messages, encryption, and passkey unlock.
- **`keys/`**: helpers for creating JWK keys and working out Arweave
  addresses.
- **`hardware/ledger/`**: signing on a Ledger device.

### Networks

- **`arweave/`**: AR balances and transfers, and reads from
  Arweave gateways.
- **`ao/`**: AO token balances and transfers, discovery of the tokens and
  collectibles an address holds, and checking whether a transfer actually
  succeeded.

### Wallet features

- **`activity/`**: combines the wallet's own record of sends with what
  the gateway reports, producing one activity feed.
- **`recipients/`**: warns when a recipient is new or looks suspiciously
  like an address the user already knows, which defends against address
  poisoning.
- **`pricing/`**: USD prices and exchange rates for display.
- **`policy/`**: which page origins may connect or ask for a signature.
- **`points/`**: the Gleam Points rules, shared with the points server
  (see `POINTS.md`).
- **`scan/`**: the community security-scan protocol, shared with the
  points server and the scan CLI (see `SCANS.md`).

### Shared

- **`models/`**: the types and constants that most of core depends on.
- **`ports/`**: the interfaces for host services, such as storage and
  approval windows, which each app implements as adapters.

## Location

```text
      @gleam/runtime
            │
            ▼
       @gleam/core      keys, signing, AO
            │
            ▼
      Arweave and AO
```

When the user sends tokens, the runtime takes the unlocked key from
`signer/` and asks `arweave/` or `ao/` to build, sign and submit the
transfer, after which `activity/` adds it to the feed.
