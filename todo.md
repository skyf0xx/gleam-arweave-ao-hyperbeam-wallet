# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## 1. Correctness and security bugs

## 2. Core wallet flows

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

- **Onboarding in the approval window races the 5-minute approval timeout (S, 🧪, opus)**
  `src/handlers/approval.ts` (`awaitResolution`), `approval/src/ApprovalRoot.tsx`.
  A `connect` with no wallet runs create/import and keyfile backup inside
  the approval window, and the timeout closes that window mid-onboarding.
  The wallet survives, but the dApp is rejected. Pause or extend the
  timeout while onboarding or unlock is showing, or keep the window open
  with a "request expired" message.
- **Approving a `connect` doesn't check the wallet is unlocked (S, opus)**
  `src/handlers/approval.ts` (`createGrant`). Only the approval window's
  UI asks for unlock first; `resolveApproval` grants a locked wallet if
  called directly from an extension page. Consider refusing a `connect`
  approval when the session has no unlocked wallet.

- **An approval outlives the service worker that was waiting for it (M, 🧪, opus)**
  `src/handlers/approval.ts` (`awaitResolution`). The 5-minute timer and
  the dApp's pending call live in the worker. If Chrome stops the worker
  while the window is open (5 minutes is also Chrome's per-event limit),
  the record stays in `session:pendingApprovals` and approving it still
  signs, and for `dispatch` posts, with nobody to receive the result.
  Consider a `createdAt` expiry check in `resolveApproval`/`getApproval`.

- **Large approval payloads may exceed `chrome.storage.session`'s quota (sonnet)**
  `src/handlers/approval.ts`. Pending approvals store the payload as a
  tagged byte array (a JSON number per byte) so it survives storage. A
  payload of a few MB can pass the 10 MB session quota. Relevant to the
  `sign`/`dispatch` item: consider base64 in storage, or a size limit.
- **Gleam yields `window.arweaveWallet` to Wander when both are installed (❓, opus)**
  `entrypoints/provider/index.ts` (`install` returns early if
  `window.arweaveWallet` exists). With Wander enabled, dApp calls go to
  Wander. Taking over is possible but needs a decision: always override,
  a "Make Gleam the default wallet" setting, or a picker. Note that
  dApps that cached Wander's object before Gleam injects won't switch. Actually no setting necessary make it default automaticaly. Wander is deprecated - don't bother with backward compatibility for cached wander objects.
- **`sign`/`dispatch` preview shows raw Winston and no fee (sonnet)**
  `entrypoints/approval/src/SigningApprovalScreen.tsx`,
  `entrypoints/background/index.ts`. The amount is the raw `quantity`
  string with no unit, and Fee is always "—" because the dApp's `reward`
  isn't shown (Total would then leave it out). Format AR and show the
  reward, fetching the price when the dApp left it out.
- **`sign` ignores its `options` argument (opus)**
  `entrypoints/background/index.ts`. arweave-js passes `SignatureOptions`
  (`saltLength`) through to the wallet. Gleam drops them and signs with
  arweave-js's default.
- **`sign`/`dispatch` reject tags that aren't UTF-8 text (sonnet)**
  `src/handlers/provider-params.ts` (`readTransaction`). Tags are decoded
  for the preview and re-encoded by `addTag`, so binary tags are refused
  rather than signed. Carry the raw tag bytes through to signing if a dApp
  needs them.
- **`signDataItem`/`batchSignDataItem` ignore their `options` argument (opus)**
  `entrypoints/background/index.ts`, `core/vault/signing.ts`. Wander takes
  `SignatureOptions` (`saltLength`) as the second argument. Gleam forwards
  it from the page but signs with arbundles' fixed salt length 32.
- **`privateHash` doesn't match permawebOS's construction (opus)**
  `core/vault/message-signing.ts`. Gleam hashes `data || d` with `d`
  decoded from base64url. permawebOS hashes `data || UTF-8(d)` (the
  base64url string's bytes), so the two give different hashes. Confirm
  Wander's construction before changing it.
- **`signMessage` preview's payload hash isn't what gets signed (sonnet)**
  `src/handlers/approval.ts` (`payloadHash`). The approval shows SHA-256 of
  the raw message. The signed payload is the `hashAlgorithm` digest, and
  permawebOS shows the SHA-256 of that digest.
- **Confirm the missing-permission error text against Wander (opus)**
  `entrypoints/background/index.ts` (`handleProviderCall`). Gleam throws
  `Missing permission(s) for "<method>": <PERMS>`, which is modelled on
  ArConnect, not copied from a live Wander. permawebOS says
  `Missing wallet permission: <PERMS>`. Match Wander if dApps parse it.
- **Aborting a provider call leaves its approval open (opus)**
  `entrypoints/provider/index.ts`, `entrypoints/content/index.ts`,
  `src/handlers/approval.ts`. An abort only rejects the page's promise.
  The approval window stays open, and approving it still signs. Add a
  cancel message through the bridge that closes the approval and rejects
  the pending request.
- **Bundled `dispatch` drops the AR transfer and fee fields (opus)**
  `core/vault/signing.ts` (`dispatchTransaction`). Over 100 KB, the
  transaction becomes a data item, and a data item can't carry
  `quantity`, `reward` or `last_tx`. A large dispatch that also sends AR
  resolves as stored, but the AR is never sent. Wander appears to do the
  reverse: it bundles only small, zero-quantity transactions and posts the
  rest as base transactions. Confirm Wander's rule. At minimum, never
  bundle when `quantity` isn't zero.
- **The signing-key-zeroization intent still requires an onSuspend wipe (sonnet)**
  `.hedgehog/intents/signing-key-zeroization.json` (RULE-2 and its test
  rule). The background no longer clears keys on `runtime.onSuspend`
  because it fires on idle and locked wallets mid-session. Update or retire
  that rule so a later pass doesn't put the handler back.
- **Concurrent approval requests overwrite each other (S, opus)**
  `src/handlers/approval.ts` (`requestApproval`, `rejectClosedWindow`,
  `dropPending`). Each reads `session:pendingApprovals`, awaits, then writes
  the whole array back. Two dApp calls at once lose one record: its window
  opens on "No pending approval" and the dApp waits for the timeout. A test
  firing two `requestApproval` calls together hung this way. Serialize the
  read-modify-write.
- **Grants left by an earlier reset outlive every wallet (sonnet)**
  `src/handlers/approval.ts` (`findActiveGrant`),
  `entrypoints/background/index.ts`. Reset and removing the last wallet
  now revoke all grants, but a profile reset before that change keeps its
  grants, and they come back into force once a new wallet is created.
  A grant's `walletId` pointing at a removed wallet is normal now (grants
  follow the active wallet), so check for "no wallets", not a missing
  `walletId`: drop all grants when the wallet list is empty.
- **Importing a keyfile that's already in the vault adds a duplicate wallet (S, sonnet)**
  `src/handlers/wallet-lifecycle.ts` (`importWallet`). Nothing checks the
  derived address against stored wallets, so the switcher shows two rows
  for one account, and they share one activity log and token list. Reject
  it, or switch to the existing wallet.
- **Back from first-run backup returns to Welcome after the wallet exists (S, sonnet)**
  `popup/onboarding/src/OnboardingView.tsx` (`Backup`'s `onBack`). The
  wallet is already stored, so Welcome's "Create a wallet" then asks to
  set a new password, which `createWallet` now rejects unless it matches
  the first. Make back finish onboarding, as the add-wallet flow does.
