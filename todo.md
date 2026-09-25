# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## Not planned

- Wander's deprecated `{ algorithm, hash, salt }` encrypt/decrypt stays
  refused (`provider-params.ts` `readEncryptAlgorithm`). Wander deprecated
  it and no dApp has asked for it. Wander's source specifies it fully if
  that changes.
- `userTokens` doesn't set `Logo` (`reads.ts`): `TokenBalance` doesn't
  carry the spawn-tag logo, and no dApp has asked for it.
- Upload is disabled in Settings until bundler uploads work with current
  AO wallets; re-enabling means restoring the row's `onOpenUpload` wiring.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->

- `packages/core/src/arweave/graphql.ts:37` — GraphQL falls back to
  `arweave-search.goldsky.com`, but `apps/extension/wxt.config.ts` grants no
  host permission for it, so the fallback may fail from the service worker.
  Verify, then add the permission or drop the fallback. S 🧪 `sonnet`
