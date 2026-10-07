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

- **M** 🧪 ❓ `opus` — Floating "Connect with Gleam" pill
  (`entrypoints/content`). dApps only show Wander/permawebOS buttons, so
  Gleam is invisible until they add one. Show a small Gleam-branded pill
  on pages detected as Arweave dApps (wallet-kit globals, aoconnect,
  `arweaveWalletLoaded` listeners) when the origin has no permissions.
  A user click (`isTrusted`) runs the normal `connect` approval; after
  that, fire `walletSwitch`/`arweaveWalletLoaded` so the page re-checks,
  and fall back to a "reload to finish" hint. Needs a per-site
  "don't show again" and a global toggle in Settings. Isolate it in a
  shadow root so page CSS can't restyle it. ❓ detection heuristics and
  whether it's on by default (Chrome Web Store review of UI injection).
