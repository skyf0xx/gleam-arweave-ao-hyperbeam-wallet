# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## 1. Correctness and security bugs

- [ ] **Concurrent approval requests overwrite each other (S, opus)**
  `src/handlers/approval.ts` (`requestApproval`, `rejectClosedWindow`,
  `dropPending`) read `session:pendingApprovals`, await, then write the
  whole array back. Two dApp calls at once lose one: its window opens on
  "No pending approval" and the dApp hangs until timeout. Done: the
  read-modify-write is serialized, with a test firing two requests together.

## 2. Core wallet flows

- [ ] **Token metadata isn't cached (S, sonnet)**
  `resolveUnregisteredTokenMetadata` hits the gateway on every
  `getTokenBalances`. Done: cached by process id in storage with no expiry
  (spawn tags never change).
- [ ] **A non-AO token still falls back to AO's denomination (S, sonnet)**
  `reads.ts` (`withUnregisteredMetadata`). When the spawn-tag lookup
  fails, the token keeps `getTokenBalance`'s AO default of 12, so its
  balance can be off by orders of magnitude (and a comment there claims
  otherwise). Done: an unresolved denomination marks the row unavailable
  instead of guessing; do this with the per-token failure item below.
- [ ] **One failing token read blanks every token balance (S, sonnet)**
  `reads.ts` (`getTokenBalances` uses `Promise.all`). Done: per-token
  failure shows that row as unavailable, and the others still render.
- [ ] **Send success has no explorer link (S, sonnet)**
  `SendView.tsx` `SuccessStep`. Upload's success step has one. Done: send
  success links to the tx in the same explorer the activity rows use
  (`MainScreenView.tsx` `openInExplorer`). Pull that into one shared helper
  so all three places build the URL the same way.
- [ ] **Importing a keyfile that's already in the vault adds a duplicate (S, sonnet)**
  `src/handlers/wallet-lifecycle.ts` (`importWallet`) doesn't check the
  derived address, so the switcher shows two rows sharing one activity
  log and token list. Done: switch to the existing wallet instead.
- [ ] **Back from first-run backup returns to Welcome after the wallet exists (S, sonnet)**
  `popup/onboarding/src/OnboardingView.tsx` (`Backup`'s `onBack`).
  "Create a wallet" then asks for a new password, which `createWallet`
  rejects. Done: back finishes onboarding, as the add-wallet flow does.
- [ ] **Onboarding in the approval window hits the 5-minute approval timeout (S, 🧪, opus)**
  `src/handlers/approval.ts` (`awaitResolution`), `approval/src/ApprovalRoot.tsx`.
  Create/import plus backup can outlast the timeout, which closes the
  window mid-onboarding and rejects the dApp. Done: the timeout doesn't
  run while onboarding or unlock is showing.

## 3. dApp provider gaps

- [ ] **Take over `window.arweaveWallet` when Wander is also installed (S, 🧪, opus)**
  `entrypoints/provider/index.ts` (`install` returns early if
  `window.arweaveWallet` exists). Decided: Gleam always becomes the
  provider, no setting. Wander is deprecated, so don't handle dApps that
  cached its object. Done: with both installed, dApp calls reach Gleam.
- [ ] **`sign`/`dispatch` preview shows raw Winston and no fee (S, sonnet)**
  `entrypoints/approval/src/SigningApprovalScreen.tsx`,
  `entrypoints/background/index.ts`. Done: the amount is formatted as AR,
  and Fee shows the dApp's `reward` (or the fetched price when it's
  missing) and is included in Total.
- [ ] **`addToken`, `isTokenAdded` and `walletVersion` are missing (M, opus)**
  `packages/messaging/src/page-protocol.ts`, `core/models/method-privileges.ts`,
  `entrypoints/provider/index.ts`, `entrypoints/background/index.ts`. Done:
  both methods are in the surface and wired to the token storage above.
  `addToken` gets an approval prompt. `walletVersion` is on the injected
  object.
- [ ] **`getArweaveConfig` ignores the gateway setting; `connect` drops `appInfo` and `gateway` (S, sonnet)**
  `entrypoints/background/index.ts`. Config is hard-coded to arweave.net.
  `appInfo` (name, logo) never reaches the connect approval screen. Done:
  config comes from network settings, and `appInfo` is shown in
  `ConnectionRequestScreen`.
- [ ] **Check `privateHash` and non-RSA-OAEP encrypt/decrypt against Wander (M, 🧪, opus)**
  `core/vault/message-signing.ts`, `core/vault/encryption.ts` (the legacy
  AES path says in its own comment that it was not taken from ArConnect).
  Done: output matches a live Wander instance for the same key and input,
  or the unsupported options are rejected clearly.

## 4. Other missing features

- [ ] **Upload screen can't be reached (M, sonnet)**
  `popup/upload/src/UploadView.tsx` is complete, but `src/App.tsx` has no
  route and nothing links to it. The UX spec's review step also wants a
  fee or cost row, which `UploadReview` lacks. Done: an entry point from
  the main screen, a route, and a cost line on review. Upload writes an
  activity entry.
- [ ] **Arweave gateway can't be edited (M, 🧪, sonnet)**
  `popup/network-peers/src/NetworkPeersView.tsx` shows the gateway
  read-only. `MainScreenView.tsx:349` hard-codes the "arweave.net" status
  label. PRD: "Editable list of … peer URLs and the Arweave gateway." Done:
  edit and validate the gateway (https only, reachable), request host
  permission as peers already do, and show the real gateway in the status
  label.
- [ ] **Address book, part 1: storage, and contacts inside Send (M, sonnet)**
 - Let's use minimalism for storage. E.g. in the interface where it says 'recent' change it to Saved addresses. Opening that screen can display recent as well as saved. Let's use minimalism even for saving addresses. E.g. on paste of an address, if it's not saved, show tick box (or similar) 'save this address'. On tick, show a blank input box with placeholder - enter address name. Just suggestions you decide good UX practices.
  New `core/models/contact.ts`, storage in `local:contacts` (one list for
  the whole vault, deduped by address; names are 1–32 characters and
  trimmed), `listContacts` / `saveContact` / `deleteContact` in
  `ProtocolMap`, and a handler. Keep it minimal (`DESIGN.md`: white space,
  no cards, color only for meaning). Contacts live where addresses are
  typed, not in their own destination:
  - Focusing Send's recipient field shows a plain list under it: saved
    contacts, then "Your wallets" (the other wallets in the vault). Each
    row is the address identicon used in the wallet switcher, the name, and
    a truncated mono address. Typing filters by name or address. Pasting a
    full address hides the list.
  - Review shows the contact's name above the full address (never
    truncated). A saved contact or one of your own wallets counts as a
    known recipient, so it skips first-seen framing.
  - Send success to an address you haven't saved shows one quiet inline
    line, "Save as contact", which opens a name field in place. No modal
    and no nag.
  Done: all of the above, with tests for the model, the handler and filtering.
- [ ] **Address book, part 2: manage contacts in Settings (S, sonnet)**
  `popup/settings-home/src/SettingsHomeView.tsx` plus a new
  `popup/contacts/` view. One "Contacts" row in Settings opens a flat list
  (same row style as part 1). "+" adds a contact with a name and a
  validated 43-character address. Tapping a row edits the name inline or
  deletes it, with no confirmation beyond an undo toast, since a contact
  is only a label. Empty state: one line of muted text, nothing else.

## Unsorted

- `apps/extension/entrypoints/provider/index.test.ts:28`,
  `apps/extension/entrypoints/content/index.test.ts:37`: `describe()` names
  cite "ARCHITECTURE.md §4.3", a doc that doesn't exist in this repo.
- `packages/core/src/vault/signing.ts` (`dispatchTransaction`): an
  AR-sending dispatch posts its data inline, so one over the gateway's
  inline limit fails and would need chunked upload.

<!-- New findings go here until they're placed in the list above. -->
