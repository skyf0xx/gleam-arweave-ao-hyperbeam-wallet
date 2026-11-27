# Threat model

The full threat model is `docs/THREAT_MODEL.md`; its § Out of scope and
§ By design list reports that are not findings. Severity rules are in
`SECURITY.md` § Severity.

## What this project does and where untrusted input enters

Gleam is a wallet for Arweave and AO: a Chrome MV3 extension and an iOS
and Android app sharing one TypeScript core. It holds RSA private keys.

Untrusted input enters from:

- websites, through `window.arweaveWallet` (`packages/provider`) and the
  content-script relay, reaching `packages/runtime/src/handlers/provider*.ts`.
  Params are parsed by the schemas in `packages/runtime/src/dispatch/methods.ts`.
- network responses from Arweave gateways, AO nodes and GraphQL
  (`packages/core/src/arweave/`, `packages/core/src/ao/`).
- a vault backup file in the user's cloud account (`packages/core/src/backup/`).
- an imported keyfile or recovery phrase (`packages/core/src/keys/`).
- hardware wallets over USB or QR (`packages/core/src/hardware/`,
  `packages/keystone`).

## Components that matter most / least

`security/surface.txt` lists the files that matter, by tier. Most
important: signing and the check that signed bytes match the approved
request (`packages/runtime/src/handlers/prepared-check.ts`), the vault and
key handling (`packages/core/src/signer/`, `packages/core/src/vault/`),
and the page-to-wallet boundary.

Least important: `apps/site`, `apps/site-open`, `apps/points-api` and
`scripts/`.

## How to exercise it

`pnpm vitest run <path>` runs the tests beside each file (`foo.ts` →
`foo.*.test.ts`). The tests stub `fetch`, so they run offline.

## How you rate severity

Rate by `SECURITY.md` § Severity: the loss (`key`, `unapproved`,
`mismatch`, `control`, `disclosure`, `lockout`) against what the attack
requires (`none`, `one-click`, `unusual`, `rare`). A malicious website is
the main attacker. A compromised device, another extension reading pages
or a bug that only a development build shows is out of scope.
