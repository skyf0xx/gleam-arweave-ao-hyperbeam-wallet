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

- `apps/extension/src/handlers/provider-params.ts` — a dApp's `last_tx`
  isn't checked as base64url. arweave-js 2.x decodes it strictly, so a
  malformed one reaches the dApp as a bare `Invalid character` error
  instead of a named `sign`/`dispatch` validation error. S `sonnet`

- Chrome Web Store: not yet submitted. First submission is manual (Developer
  Dashboard, $5 one-time registration, store listing copy/screenshots,
  privacy-practices disclosures, and a manual review pass since this is a
  wallet). Once that first listing exists and has an extension ID, add a
  tag-triggered release workflow (`chrome-webstore-upload` API, secrets:
  `EXTENSION_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`) so future
  releases are a version-tag push. S ❓ `sonnet`
