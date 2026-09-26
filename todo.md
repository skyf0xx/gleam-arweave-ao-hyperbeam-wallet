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
- Pinning back to Vite 7. We stay on Vite 8: `packages/core/src/arweave/client.ts`
  handles its CommonJS default-import interop, and `pnpm test:smoke`
  catches the next bundle-only crash like it.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->

- `arweave` is pinned to 1.15.7; the 2.1.0 bump (Dependabot PR #14, closed)
  breaks `Transaction.get`/`createTransaction` — `b64UrlToBuffer` throws
  `InvalidCharacterError`, hit directly by `submitTransfer`
  (`packages/core/src/arweave/transfer.ts:61`) and caught by
  `transfer.arweave.test.ts` + `transfer.send.test.ts`. Upgrading needs a
  real pass: read arweave-js's v2 migration notes, adapt `transfer.ts`,
  re-test AR sends manually in Chrome. M 🧪 `opus`

- Chrome Web Store: not yet submitted. First submission is manual (Developer
  Dashboard, $5 one-time registration, store listing copy/screenshots,
  privacy-practices disclosures, and a manual review pass since this is a
  wallet). Once that first listing exists and has an extension ID, add a
  tag-triggered release workflow (`chrome-webstore-upload` API, secrets:
  `EXTENSION_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`) so future
  releases are a version-tag push. S ❓ `sonnet`

- `packages/core/src/arweave/graphql.ts:37` — GraphQL falls back to
  `arweave-search.goldsky.com`, but `apps/extension/wxt.config.ts` grants no
  host permission for it, so the fallback may fail from the service worker.
  Verify, then add the permission or drop the fallback. S 🧪 `sonnet`
