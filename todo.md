# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->

- **`transferAoTokens`'s signing-approval preview shows the raw atomic amount, undenominated (S)**
  `entrypoints/approval/src/SigningApprovalScreen.tsx`'s `formatAmount`,
  `entrypoints/background/index.ts`'s `transferAoTokens` case. Unlike
  `sign`/`dispatch` (AR, 12 decimals, now formatted), an AO transfer's
  approval preview has no token denomination available at that layer, so
  its amount still renders as a raw smallest-unit integer. Wiring in the
  token's `denomination` (already read for balances) would let it use
  `formatAtomicAsDisplay` for real instead of a no-op.
- **`tokenBalance` and `userTokens` can't be called from a page (S)**
  `entrypoints/provider/index.ts`. Both are in `PROVIDER_SURFACE_METHODS`
  and handled in `entrypoints/background/index.ts`, but `GleamProvider`
  has no method for either, so `window.arweaveWallet.tokenBalance` is
  `undefined`.
- **`walletVersion` reports `0.0.0` (S)**
  `apps/extension/package.json`. The injected `walletVersion` and the
  manifest version both come from this field, which was never set to a
  release version.
- **Wander's deprecated `{ algorithm, hash, salt }` encrypt/decrypt is refused (M)**
  `apps/extension/src/handlers/provider-params.ts` `readEncryptAlgorithm`.
  Wander still serves it: a random 256-byte key wrapped with RSA-OAEP
  (first 512 bytes), then arweave-js `crypto.encrypt` (PBKDF2-SHA256 100k,
  AES-256-CBC, random IV) over `data || salt`, with the salt stripped on
  decrypt. It is fully specified in Wander's source, so parity is
  reachable if a dApp needs it.
