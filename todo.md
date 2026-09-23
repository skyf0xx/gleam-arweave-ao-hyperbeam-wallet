# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## 1. Correctness and security bugs

- [ ] **Provider message calls never reach the background in a usable shape (M, 🧪, opus)**
  `entrypoints/provider/index.ts`, `entrypoints/background/index.ts`,
  `src/handlers/approval.ts`. The provider posts `{ data, options }` with
  `data` as a tagged binary (`{__gleamType, data: number[]}`), but the
  background calls `decodeBase64Payload(params.data)` and reads
  `params.options.hashAlgorithm` / `params.algorithm`. So `signMessage`,
  `signature`, `privateHash`, `encrypt`, `decrypt` and `verifyMessage` fail
  on any real dApp call (`encrypt`/`decrypt` always throw "requires an
  algorithm"). Done: one shared decoder for provider params in the
  background; these six methods accept Wander's argument shapes
  (`verifyMessage(data, signature, publicKey?, options?)` with `publicKey`
  defaulting to the active key); results match Wander (`Uint8Array` for
  signatures, hashes and ciphertext, `boolean` for `verifyMessage`, not
  `{signature}` / `{hash}` / `{data: base64}` / `{valid}`). Tests drive a
  request through the provider, the content relay and the background.
- [ ] **`sign` and `dispatch` ignore the dApp's transaction (M, 🧪, opus)**
  Same files, plus `core/vault/signing.ts`. The provider sends
  `{ transaction, options }`, but the background reads
  `target` / `data` / `tags` from the top level, so the approval preview and
  the signed transaction are empty. arweave-js tags arrive base64url-encoded
  and `addTag` would encode them again. Done: unwrap `transaction`, decode
  its data and tags, and return what `arweave.transactions.sign(tx)` expects
  from `window.arweaveWallet.sign` (`id`, `owner`, `signature`, `reward`,
  `tags`). `dispatch` returns `{ id, type }`. Test with arweave-js
  `use_wallet` in Chrome.
- [ ] **`signDataItem` / `batchSignDataItem` return the wrong shape (M, 🧪, opus)**
  Same files. The provider sends `{ dataItem }` and the background reads
  `params.data`, so the data item is signed with empty data. Results come
  back as `{signedDataItem: base64}`. Wander returns an `ArrayBuffer` (and
  an array of them for batch). Done: correct input and output shapes. A
  signed item parses with arbundles and verifies. Check it with aoconnect's
  `createDataItemSigner(window.arweaveWallet)`.
- [ ] **Granted permissions are never enforced (M, opus)**
  `entrypoints/background/index.ts` (`handleProviderCall`). Any connected
  origin can call any method whatever it was granted. There is no
  method→permission map anywhere (`packages/messaging/src/permissions.ts`
  only re-exports). Done: a map in `core/models` (`sign`→`SIGN_TRANSACTION`,
  `getAllAddresses`→`ACCESS_ALL_ADDRESSES`, `getActivePublicKey`→
  `ACCESS_PUBLIC_KEY`, `dispatch`→`DISPATCH`, `encrypt`/`decrypt`,
  `signature`/`signMessage`→`SIGNATURE`, `getArweaveConfig`→
  `ACCESS_ARWEAVE_CONFIG`, token reads→`ACCESS_TOKENS`, and so on), checked
  before dispatch, with a Wander-style error for a missing permission.
  Tests cover each method.
- [ ] **Aborting any provider call disconnects the dApp (S, opus)**
  `entrypoints/provider/index.ts` (`onAbort`). It posts a `disconnect`
  request with `{cancelOf}`, which the background runs as a real disconnect
  and grant revoke. Done: an abort only rejects locally (or sends a real
  cancel message), and never revokes the grant. Regression test.
- [ ] **Large `dispatch` signs a bundled data item and never uploads it (M, opus)**
  `core/vault/signing.ts` (`dispatchTransaction`, over 100 KB). It returns
  `{id, type: "BUNDLED"}` for a data item that is never posted anywhere, so
  the dApp thinks the data is stored. Done: POST the item to the bundler
  (`core/arweave/upload.ts` already has the path) and fail loudly if the
  upload fails. Test with a stubbed fetch.
- [ ] **Provider times out at 60 s while the approval waits 5 min; closing the window doesn't reject (M, 🧪, opus)**
  `entrypoints/provider/index.ts` (`REQUEST_TIMEOUT_MS`),
  `src/handlers/approval.ts` (`APPROVAL_TIMEOUT_MS`),
  `src/adapters/windows.ts`. If the user approves after 60 s, the dApp has
  already seen a timeout, but a `dispatch` still posts. Closing the approval
  window with the X leaves the request pending for 5 min. Done:
  approval-gated methods have no short page timeout (or it's longer than
  the approval timeout). `windows.onRemoved` rejects the pending request.
  The window-id map survives a service-worker restart (store it in
  `session:`).
- [ ] **Auto-lock is not enforced when a key is used (M, opus)**
  `src/handlers/key-session.ts` (`getCachedKey`),
  `src/handlers/wallet-lifecycle.ts` (`loadSession`). Expiry is only checked
  when something calls `getState()`. `approval.ts`, `transfer.ts` and
  `upload.ts` read the key directly, so a dApp can get a signature after the
  auto-lock time has passed. Done: every key read checks session expiry and
  clears the cache when it has expired. Tests use fake timers.
- [ ] **The UI can say "unlocked" while the key cache is empty (M, 🧪, opus)**
  `entrypoints/background/index.ts` (`runtime.onSuspend` →
  `clearKeyCache`) vs `wallet-lifecycle.ts` (`getState`). If Chrome fires
  `onSuspend` when the service worker idles out, the keys are wiped but
  `session:unlockedSession` stays, so signing fails with "locked" while the
  popup shows the wallet as open. Done: check in Chrome whether `onSuspend`
  fires on idle. Either stop clearing on suspend (session storage is
  already memory-only) or make `getState` report locked when no key is
  cached.
- [ ] **Reset and delete leave dApp grants behind (S, opus)**
  `wallet-lifecycle.ts` (`resetAllWallets`, `deleteWallet`),
  `approval.ts` (`local:grants`). After "Forgot password" → reset, a fresh
  wallet inherits every old grant, and `getAllAddresses` answers without a
  new approval. Done: reset clears grants, activity logs, watched tokens
  and pending approvals. Deleting a wallet revokes its grants. Tests.
- [ ] **The background trusts the claimed origin and any caller (M, opus)**
  `entrypoints/background/index.ts`. `providerCall` uses
  `message.data.origin` instead of the sender's tab URL. Privileged methods
  (`resolveApproval`, `exportWallet`, `createWallet`, …) accept messages
  from content-script contexts. Done: take the origin from `sender`. Only
  accept `providerCall` from content scripts, and only accept everything
  else from extension pages (`sender.url` starts with
  `runtime.getURL("")`). Tests.
- [ ] **dApps keep seeing the old wallet after a switch (M, opus)**
  `entrypoints/background/index.ts` (`getActiveAddress` uses
  `grant.walletId`; `connect` uses `session.unlockedWalletIds[0]`).
  `walletSwitch` announces the new address, but the next
  `getActiveAddress()` returns the old one. Done: provider reads use the
  active wallet, and `connect` binds to the active wallet. Tests.
- [ ] **The approval window reports success when signing failed (S, opus)**
  `entrypoints/approval/src/ApprovalRoot.tsx`,
  `approval.ts` (`resolveApproval` stores `outcome.error` and returns
  normally). A locked wallet or a network failure shows "Signed." Done:
  `resolveApproval` returns or throws the outcome, and the window shows the
  real error.

## 2. Core wallet flows

- [ ] **Store and show why an AO send failed (S, sonnet)**
  `core/ao/result.ts` returns `{ status: "failed", error }`, but
  `ReadsHandler.resolvePendingAoTransfers` (`src/handlers/reads.ts`) saves
  only the status. Done: the reason is persisted on the entry and shown in
  the activity row.
- [ ] **AO amounts in the activity list are labelled "AR" (S, sonnet)**
  `popup/main-screen/src/MainScreenView.tsx:524` formats every entry with
  `formatWinstonAsAr(...) AR`. Done: token entries use the token's
  denomination and ticker (see `SendView.tsx`'s `formatAtomicAsDisplay`).
  Explorer links are the activity detail view (decided), so no in-app
  detail screen or paging is planned.
- [ ] **AR "Max" and the balance check ignore the network fee (S, sonnet)**
  `popup/send/src/SendView.tsx:393`,
  `popup/activity/src/validateSendAmount.ts`. "Max" fills in the whole
  balance, and amount + fee > balance is only rejected by the gateway.
  Done: for AR, Max is balance minus the estimated fee, and review blocks
  when amount + fee is more than the balance.
- [ ] **"Add wallet" button does nothing (M, opus)**
  `popup/wallet-switcher/src/WalletSwitcherView.tsx:127-138`. After
  onboarding there is no way to create or import a second wallet. Done:
  create and import from the switcher, reusing the onboarding steps minus
  the create-password step. All wallets share the one vault password
  (decided): the flow asks for the current password once, checks it
  against an existing wallet's envelope, and encrypts the new wallet under
  it. `createWallet` and `importWallet` reject a password that doesn't open
  the vault when wallets already exist. Never prompt for a new password.
- [ ] **Wallet "Manage" menu does nothing: rename and back up (M, sonnet)**
  `WalletSwitcherView.tsx:178-184`. `renameWallet` and `exportWallet` are
  wired in the background but have no UI after onboarding. Done: a wallet
  detail screen with rename and a password-gated keyfile download. Record
  that a backup was confirmed (needed by the next item).
- [ ] **Remove a wallet, with the spec's backup warning (M, sonnet)**
  Same screen, `wallet-lifecycle.ts` (`deleteWallet`). PRD: "Removing a
  Wallet with no confirmed backup warns explicitly that access will be lost
  permanently." Done: remove action with Irreversible-tier confirmation
  when no backup is recorded. Removing the last wallet goes back to
  onboarding.
- [ ] **dApp requests fail when the wallet is locked or doesn't exist yet (M, 🧪, opus)**
  `entrypoints/background/index.ts` (`connect` throws "No unlocked wallet"
  before any window opens), `approval/src/ApprovalRoot.tsx` (no unlock
  state; its onboarding branch can't be reached). Done: a locked wallet
  shows unlock inside the approval window and then continues the request.
  With no wallet, onboarding opens in place (PRD "Signing approval").
- [ ] **`connect()` asks again when the app already has the permissions (S, opus)**
  `entrypoints/background/index.ts` (`connect` always calls
  `requestApproval`). Many dApps call `connect` on every page load. Done:
  resolve right away when an active grant already covers what was asked
  for, and only prompt for new permissions (merged into the grant).
- [ ] **Token list: add AO tokens and store them (M, sonnet)**
  `src/handlers/reads.ts` reads `local:watchedProcessIds:{address}`, but
  nothing writes it, so only the default AO token ever shows. Done: add
  (paste a process id, preview ticker and balance) and remove in the
  popup, stored per address. Unblocks `addToken` below.
- [ ] **Unregistered tokens get AO's denomination and no name (S, sonnet)**
  `core/ao/balance.ts` defaults bare-quantity replies to denomination 12.
  `withUnregisteredMetadata` (`reads.ts`) resolves ticker and denomination
  but not the name, and `TokenBalance` has no `name`. Done: the name is
  resolved and carried through. The denomination always comes from token
  metadata for non-AO tokens.
- [ ] **Token metadata isn't cached (S, sonnet)**
  `resolveUnregisteredTokenMetadata` hits the gateway on every
  `getTokenBalances`. Done: cached by process id in storage with no expiry
  (spawn tags never change).
- [ ] **One failing token read blanks every token balance (S, sonnet)**
  `reads.ts` (`getTokenBalances` uses `Promise.all`). Done: per-token
  failure shows that row as unavailable, and the others still render.
- [ ] **Send success has no explorer link (S, sonnet)**
  `SendView.tsx` `SuccessStep`. Upload's success step has one. Done: send
  success links to the tx in the same explorer the activity rows use
  (`MainScreenView.tsx` `openInExplorer`). Pull that into one shared helper
  so all three places build the URL the same way.

## 3. dApp provider gaps

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
- [ ] **`userTokens()` never lists unregistered tokens (S, sonnet)**
  `reads.ts` (`userTokens` skips any token without a registry name). Done:
  uses the resolved name from the token-name item above.
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

## 5. Polish and cleanup

- [ ] **Delete the dead `ReadsHandler.getConnectedApps` stub (S, sonnet)**
  `src/handlers/reads.ts` returns `[]`, but the background routes
  `getConnectedApps` to `ApprovalHandler`, which reads `local:grants`.
  Done: remove the stub and its test (`reads.activity.test.ts`).
- [ ] **Remove unused wire contracts (S, sonnet)**
  `packages/messaging/src/signing-protocol.ts` and `token-protocol.ts` are
  only imported by their own tests. Done: either the provider and
  background use them after the section 1 fixes, or they're deleted.
- [ ] **Strip build-log comments from `packages/` (S, sonnet)**
  About 180 comments across 63 files narrate the old build ("this task's",
  "ALLOWED SCOPE", "final report", "debt #1", "RELEVANT RULES"), and some
  are now false (for example `core/ao/balance.ts` still says the balance
  shape is "unverified"). Done: `packages/` comments keep only the
  non-obvious why.
- [ ] **Strip build-log comments from `apps/extension` (S, sonnet)**
  Same, for `apps/extension` (the background, provider, content, App and
  handlers are the worst).

## 6. Hedgehog cleanup

- [ ] **Remove the Hedgehog scaffolding (M, sonnet)**
  `.hedgehog/`, the Hedgehog agents and skills in `.claude/`, `AGENTS.md`,
  and the per-layer test-naming conventions (the `*.<layer>.test.ts`
  suffixes can stay). First move `.hedgehog/BMAD/04-prd.md` and
  `05-ux-spec/EXPERIENCE.md` to `docs/` if they're still the spec. In them,
  change the activity section to say explorer links are the detail view,
  and state the single vault password. Keep
  anything in `.hedgehog/core-design.md` that `CLAUDE.md` doesn't already
  cover.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->
