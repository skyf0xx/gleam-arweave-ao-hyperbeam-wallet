# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## 4. Other missing features

- [ ] **Address book, part 2: manage contacts in Settings (S, sonnet)**
  `popup/settings-home/src/SettingsHomeView.tsx` plus a new
  `popup/contacts/` view. One "Contacts" row in Settings opens a flat list
  (same row style as part 1). "+" adds a contact with a name and a
  validated 43-character address. Tapping a row edits the name inline or
  deletes it, with no confirmation beyond an undo toast, since a contact
  is only a label. Empty state: one line of muted text, nothing else.
- [ ] **Upload screen can't be reached (M, sonnet)**
  `popup/upload/src/UploadView.tsx` is complete, but `src/App.tsx` has no
  route and nothing links to it. Upload is rarely used, so it gets no
  main-screen button: it lives in Settings, found by someone looking for
  it. In `popup/settings-home/src/SettingsHomeView.tsx`, add a "Tools"
  section between Network and General with one row, "Upload to Arweave",
  subtitle "Store a file permanently". Back from Upload returns to
  Settings. The UX spec's review step also wants a fee or cost row, which
  `UploadReview` lacks. Done: the Settings row, a route, and a cost line
  on review. Upload writes an activity entry.

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
