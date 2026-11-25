# Gleam threat model

Gleam is a wallet for Arweave and AO. It ships as a Chrome extension and
as an iOS and Android app, and both run the same core and runtime. This
document describes what Gleam protects, who it protects against, how,
and where the protection stops, on each shell. It describes the current
code. Deliberate trade-offs are listed under [By design](#by-design),
and gaps under [Known limitations](#known-limitations), rather than left
out.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What Gleam protects

1. **The keyfile.** An Arweave RSA-4096 key (JWK). Whoever has it controls
   the wallet's AR, AO tokens and collectibles, permanently.
2. **The user's consent.** Nothing is signed, decrypted or sent unless the
   user approved that exact request.
3. **Privacy.** Which sites the user connects to, and which addresses
   belong to the same person.

## Architecture and trust boundaries

Both shells have the same four layers. Only the runtime holds unlocked
keys and signs.

```text
 dApp page (untrusted)      provider script; window.arweaveWallet
        │ top frame only, origin read by the platform
 relay                      passes page calls on, adds nothing
        │
 runtime (trusted)          dispatcher, handlers, approvals, keys
        │
 wallet UI (trusted)        Gleam's own screens and approval UI
```

| Layer | Extension | App (iOS, Android) |
| --- | --- | --- |
| dApp page | A browser tab | A native dApp WebView with its own profile and data store |
| Relay | Content script in the isolated world, top frame only | The dApp WebView's native message handler, passed on by the wallet WebView |
| Runtime | Background service worker | A dedicated worker started by the wallet WebView |
| Unlocked keys | Keyring offscreen document | The runtime worker's heap |
| Wallet UI | Popup, side panel, approval window, passkey window | The wallet WebView, which draws the approval sheet |

- **The runtime decides who is asking from the platform, never from the
  message body.** In the extension, that is Chrome's `sender`. A content
  script can send only `providerCall` (plus two read-only questions
  about its own tab). Every other method, including key export, wallet
  creation and approving requests, is accepted only from the extension's
  own pages (`isExtensionPageSender` in `apps/extension/src/sender.ts`).
  In the app, a dedicated worker hears only the page that started it,
  which is the wallet WebView loading the bundled app, so its calls get
  the extension pages' tier. dApp pages have no handle on the worker.
  Their calls arrive through `pageCall` with the content script's tier
  (`apps/mobile/src/worker/host.ts`).
- **A page's origin is the one the platform reports for the sending
  frame.** Only the top frame counts. In the extension, iframes never
  get the content script. In the app, native code reads each message's
  origin and frame from the WebView (`WKFrameInfo` on iOS, the web
  message listener on Android), and `attestedOrigin`
  (`apps/mobile/src/adapters/dapp-bridge.ts`) drops a subframe's message
  and any origin that isn't an exact http(s) origin. A sandboxed
  document with an opaque origin is refused on both shells.
- **A page can reach a fixed list of methods** (`PROVIDER_SURFACE_METHODS`
  in `packages/messaging/src/page-protocol.ts`), disjoint from the key and
  approval methods. Anything else is rejected before a handler runs.
- **The app's worker answers only named methods.** Comlink would follow
  any property path, so `exposeMethods`
  (`apps/mobile/src/adapters/comlink-guard.ts`) lets through only a
  one-segment call to `dispatch`, `pageCall`, `tabClosed`, `resume` or
  `openLink`, with plain cloned arguments.
- **A site must be connected before it can read anything**, and `connect`
  itself needs the user's approval. Connections can be revoked in
  Settings → Connected apps.

## How the key is kept

**At rest.** The keyfile is encrypted with AES-256-GCM under a key derived
from the user's password by Argon2id (64 MiB, 5 passes, parallelism 1,
16-byte random salt, 12-byte random IV). The ciphertext is bound to its
wallet record by additional authenticated data
(`gleam:v2:<walletId>:<address>`), so an envelope moved onto another
wallet's record fails to decrypt. The derived key is a non-extractable
WebCrypto key, and the password bytes and the raw Argon2id output are
zeroed after use. A PBKDF2-HMAC-SHA256 (v1, 600,000 iterations) envelope
still opens, and unlocking re-encrypts it with Argon2id. Stored Argon2id
parameters are bounded, so a corrupted envelope can't make the runtime
allocate gigabytes. See `packages/core/src/signer/envelope.ts`.

The extension stores the vault in `chrome.storage.local`. The app stores
it in a SQLite database that the runtime worker alone writes
(`apps/mobile/src/adapters/storage.ts`). The database itself is not
encrypted again, since the vault inside is already sealed. Neither
platform's backup copies it: on iOS the database sits in
`Library/CapacitorDatabase`, which the SQLite plugin creates excluded
from iCloud and device backups (`capacitor.config.ts`). On Android,
`allowBackup="false"` and `data_extraction_rules.xml` exclude every
domain from cloud backup and device transfer.

**While unlocked.** Unlocking decrypts the keyfile and imports it as
non-extractable WebCrypto keys: one RSA-PSS signing key per hash
(SHA-256, SHA-384, SHA-512) and one RSA-OAEP decryption key. They can
sign and decrypt, but their bytes can't be exported, and they exist only
in memory. Nothing key-related is written to disk: not IndexedDB, which
would store the key material in the browser profile, and not storage. No
code keeps a reference to the decrypted JWK after the import, but parsed
copies stay in memory until garbage collection, since JavaScript can't
overwrite strings. Since no private key material is readable while
unlocked, `privateHash` is refused (see [By design](#by-design)).

- **Extension.** The background hands the JWK, once, to the keyring: an
  offscreen document it opens for this alone
  (`apps/extension/entrypoints/keyring/`). The keyring opens one port
  to the background and reopens it whenever the service worker
  restarts. The background accepts that port only from the keyring
  document, judged by Chrome's sender (extension id, page URL, no tab,
  offscreen document id), and disconnects any other page that connects
  under the keyring's name. What the background posts on the port
  reaches only the keyring, so the JWK goes nowhere else. What the
  keyring posts back, signatures and decrypted plaintexts, reaches every
  extension page listening for connections, and such a page could also
  send the keyring requests. No Gleam page listens; a compromised one is
  the "compromised dependency" case below: it can get signatures and
  decryptions while the wallet is unlocked, never the key.
  `chrome.storage.session` holds only the address, the public key and
  which wallets are unlocked. That storage lives in memory only, is
  cleared when the browser closes, and is not readable by content
  scripts or web pages. A wallet counts as unlocked only while the
  session lists it and the keyring holds its key; if the keyring
  document is gone, the wallet reads as locked.
- **App.** The keys live in the runtime worker's heap
  (`apps/mobile/src/adapters/session-key-store.ts`), and so do the
  session records, which never reach SQLite or the wallet WebView's main
  thread (`apps/mobile/src/adapters/storage.ts`). The main thread can
  ask the worker to sign or decrypt through `dispatch`, but has no path
  to the keys. The OS ending the app's process locks every wallet.

Lock, auto-lock, wallet removal and reset clear the keys, and so does
browser startup in the extension. Locking overwrites each session entry
before removing it. Lock and unlock run one at a time, so a lock can't
race an unlock and leave keys behind. Auto-lock is checked on every key
read and on a one-minute timer, so the keys go when the timeout passes
even if nothing reads them. The timeout counts from the last time
Gleam's own screens loaded the wallet state, or the user approved or
rejected a request; a connected site's calls, and the approvals it
opens, don't extend it. New installs default to 1 hour. In the
extension, the vault also locks when the computer's screen locks,
unless auto-lock is set to "never" (see [By design](#by-design)). The
app's OS suspends its JavaScript in the background, and the timer then
runs every check it missed, once, as the app resumes
(`apps/mobile/src/adapters/timer.ts`). See
`packages/runtime/src/handlers/key-session.ts`.

**Passkey unlock (extension).** A passkey's WebAuthn PRF output wraps the
vault password. Unlocking with a passkey recovers the password and then
unlocks exactly as typing it would. The relying party is the extension's
own id.

**Biometric unlock (app).** The vault password is stored with the OS's
biometric protection and read back only after the OS's own biometric
check: Keychain access control on iOS, a Keystore key bound to a
`BiometricPrompt` `CryptoObject` on Android, which only strong (Class 3)
biometrics can release. The OS discards it when the enrolled biometrics
change. Unlocking with biometrics then unlocks exactly as typing the
password would (`apps/mobile/src/adapters/biometric-unlock.ts`).

**Hardware wallets.** Keystone (both shells) and Ledger (the extension)
keep the key on the device. Gleam stores only the public key and
address.

**Watch wallets.** A watch wallet is only an address, with no key. A
site can't connect while one is active, and every signing call for it
is refused before any approval opens.

**Vault backup.** Backup is off until the user turns it on. It keeps one
file in the user's own cloud account: a Google Drive app folder in the
extension and on Android (the `drive.appdata` scope, which reaches no
other file), and a record in the app's CloudKit private database on
iOS. The file's body is encrypted under a random backup key, which is
stored wrapped under the vault password in the same Argon2id envelope
the wallets use (`packages/core/src/signer/backup-key.ts`), and held
unwrapped only beside the signing keys while Gleam is unlocked. The
body holds the wallets with their sealed keyfiles, contacts, added
tokens, saved sites and settings, and only the storage keys
`packages/core/src/backup/file.ts` lists. The clear header holds the
wrapped backup key and, for each enrolled passkey, the vault password
wrapped under that passkey's PRF output, as on the device.

## Signing and approvals

- **Every signing, decryption and transfer request from a site opens
  Gleam's own approval UI** with a preview decoded from the request. In
  the extension, it is a separate Gleam window (a Chrome popup window,
  not part of the page). In the app, it is the approval sheet, drawn by
  the wallet WebView with the dApp view hidden; requests that arrive
  meanwhile wait their turn (`apps/mobile/src/adapters/approval-sheet.ts`).
- **The approval UI can't change what gets signed.** It returns only the
  request id and approve or reject. The runtime signs its own stored copy
  of the request, so the preview and the signed bytes come from the same
  object.
- **A security phrase marks Gleam's own screens.** A user who picks one
  sees it, with an icon drawn from it, on the unlock screen and every
  approval. A page can't read Gleam's storage, so a fake approval drawn
  in a page can't show it
  (`packages/core/src/models/security-phrase.ts`).
- **Gleam Points payloads are refused from sites.** A `signMessage`
  whose data starts with `gleam-points:`, and a `sign` or `dispatch`
  with a `Gleam-Points` tag, are refused before any approval opens
  (`packages/runtime/src/dispatch/methods.ts`). The tag refusal adds to
  how a hardware proof is built (`core/points/ownership.ts`), which
  already keeps a site's transaction from matching one.
- **There is no auto-approval.** No setting lets a site sign without the
  approval UI.
- **Requests expire.** An unanswered request is rejected after 5 minutes
  (20 for a scan attestation from the Gleam site). A hardware wallet's
  request waiting on the device can run to 15 minutes from creation (30
  for a scan attestation) while the approval reports device activity.
- **AO messages are built and signed with plain WebCrypto**
  (`packages/core/src/ao/transfer.ts`). No third-party library touches
  the key on the signing path.

## Attackers

| Attacker | What they try | What stops them | What's left |
| --- | --- | --- | --- |
| Malicious website or dApp | Read addresses, sign or send without consent, reach key methods | Connect approval; per-request approval; fixed method list; origin from the platform, top frame only | A user approving a request they don't understand. The preview is the defense. |
| Phishing site or fake approval drawn in a page | Trick the user into typing the password or approving | Real requests open Gleam's own window in the extension, and the approval sheet with the dApp view hidden in the app; the security phrase, once picked, shows on every real unlock and approval; Gleam never asks for the password inside a page | Users who don't know the rule or haven't picked a phrase. |
| Another browser extension | Inject into a page and call `window.arweaveWallet` as that page, open a window styled like Gleam's approval, read Gleam's storage or reach the keyring | Gleam's `chrome.storage` and its extension pages are per-extension; the keyring port accepts only Gleam's own offscreen document (`isKeyringSender` in `apps/extension/src/adapters/offscreen-keyring.ts`); a call made as the page still opens Gleam's approval window | A convincing fake approval window that asks to approve or for the password, the phishing case above. An extension with the `debugger` permission can read anything and is the malware case below. |
| Another app on the phone | Read Gleam's storage, reach the runtime, open Gleam with a crafted link, draw over the approval sheet | The OS sandbox keeps Gleam's database and WebViews private; the worker can't be reached from outside the app; Gleam claims only verified https links on `open.gleamwallet.app` (universal links, App Links with `autoVerify`) and registers no custom URL scheme; every link is parsed as untrusted (`apps/mobile/src/worker/points-link.ts`, `apps/mobile/src/adapters/browse-link.ts`); Android 12 and later drop taps that pass through another app's opaque overlay | Anyone can send a link: see the gleamwallet.app row. An overlay on Android 8 to 11, or a mostly transparent one on 12 and later, can pass taps through to the approval sheet (see Known limitations). An app with accessibility access is the malware case below. |
| Network attacker | Inject requests into a page, tamper with data | Code ships in the package, never fetched: the extension in the CRX, the app in its bundled `dist/` with no `server.url` and no live-update plugin; HTTPS for all wallet traffic; plain-`http://` sites can't connect, read or request a signature, except `localhost`, `127.0.0.1` and `[::1]` | Loopback `http://` stays allowed for local development; its traffic never crosses the network. |
| Compromised npm dependency | Read the unlocked key and send it out | Locked dependency versions; new releases held back 3 days; provenance downgrades refused; dependency PRs reviewed by CI | Code running inside the extension or the app can ask for signatures and decryptions while the wallet is unlocked, and can reach any https host or load an image from any https URL. It can't copy the key: unlocked keys are non-extractable. The largest open risk. |
| Hijacked store account | Push a malicious update to every user | The accounts' own login protection. Chrome Web Store: releases are packed and signed with an offline CRX key before upload. Play: every upload must be signed with the upload key, held in a KeePassXC database. App Store: none beyond the account | A Web Store takeover alone can't publish a tampered build, since the upload must match the signed CRX; it could still publish an unrelated or reverted listing change. A Play takeover can ask Google to reset the upload key. An App Store Connect takeover can create its own distribution certificate and ship a build. |
| Hijacked GitHub account or token | Change the source or CI | 2FA; protected `master`: signed commits, PR with passing CI, no force-push, no admin bypass | An account takeover can change the rules. |
| Malware on the user's computer or phone | Copy the vault, log keystrokes | Encrypted vault; unlocked keys in memory only, cleared on lock | Malware that can read process memory or keystrokes wins, and so does a rooted or jailbroken phone's; no software wallet can stop it. A stolen vault can be attacked offline: see the password policy under By design. |
| Someone at an unlocked browser | Send funds, export the key | Export needs the password; sends need confirmation | Auto-lock is 1 hour by default; the user can choose "never", with a warning. |
| Thief with the phone, or someone at an unlocked phone | Send funds, export the key | The vault is encrypted at rest; biometric unlock keeps the password behind the OS's own biometric check; leaving the app dismisses any open approval sheet (`apps/mobile/src/adapters/app-away.ts`); auto-lock locks after the chosen time without use | Locking the phone or leaving the app doesn't lock Gleam. Within the auto-lock time, the same as an unlocked browser. See Known limitations. |
| Compromised cloud account | Read or replace the vault backup | The backup's body is encrypted under a key wrapped under the vault password; a file the password can't open is never joined or merged into this install; each restore checks the clear header against the encrypted copy | A stolen backup can be attacked offline as a stolen vault can. Deleting the file loses the backup. |
| Compromised gleamwallet.app | Message the extension, put a signing request in front of the user, show announcements | The site sends only the `SITE_MESSAGES` in `packages/runtime/src/dispatch/methods.ts`: `gleam-points:invite` hands over an invite code, `gleam-points:attest` opens a scan-attestation approval, which signs only a points ownership message, never a transaction, and `gleam-points:attest-status` asks only whether the wallet can sign one. Announcement links are limited to the Gleam site and x.com; a production build accepts site messages only from `https://gleamwallet.app` (`isSiteOrigin` in `packages/runtime/src/dispatch/site.ts`). In the app, the invite and attest messages arrive as links on `open.gleamwallet.app` instead, held to the same handlers and schemas | Misleading announcement text, and an attestation prompt the user didn't ask for. Anyone can write an app link, so in the app those two hold for any sender of a link. A development build of the extension also accepts site messages from any `http://localhost` or `http://127.0.0.1` page, so local pages can send it invites and scan attestations. |
| Compromised maintainer machine | Steal the CRX signing key or the store and keystore credentials, or ship a tampered build | The keys live in a KeePassXC database unlocked only at the signing step; the release zip is built and attested in CI; `pack-release.sh` signs that downloaded zip after checking its hash and `gh attestation verify`, and runs no npm code. The local rebuild (`verify-release.sh`) runs in a separate terminal session and leaves a receipt of the hash it reproduced; `pack-release.sh` signs only a zip that matches it. `release-app.sh` builds the app's web bundle from a signed tag on `master` and signs only a bundle whose hash matches the release manifest's `mobileBundleSha256`, before any credential is unlocked | A compromised machine itself. The CRX key is written to a private temp file for the `chrome --pack-extension` call. The app's native projects are compiled and signed on the machine. |
| Compromised CI or GitHub Action | Swap the release zip or manifest, mint a provenance attestation for another file, or exfiltrate a token | Every Action is pinned to a commit SHA; Dependabot never auto-merges an Action bump or a production dependency; release jobs block egress (harden-runner) and hold no signing key or store credential; the CRX is signed only for a zip a local rebuild of the tag reproduced | A malicious Action merged after review runs with the release job's write and OIDC tokens. |
| Lying gateway, AO unit, HyperBEAM peer or price API | Show wrong balances, history or prices | Signed transactions are built locally from the user's own input; a token's decimals are kept only when two other gateways agree, and otherwise stay unknown so amounts show unscaled (`queryCheckedTokenMetadata`); peers discovered from on-chain Location records only serve reads and never get a host permission of their own | Wrong balances or history on screen; a dishonest gateway can drop a transaction. A discovered peer is anyone who published a Location record. |

## Network

Gleam talks to:

- **Arweave gateways:** `arweave.net` by default, a few fallbacks, or one
  the user sets. Used for balances, history (GraphQL) and posting
  transactions.
- **`up.arweave.net`:** the bundler that a site's `dispatch` posts to.
- **AO:** `mu.ao-testnet.xyz` (sending messages), `cu.ao-testnet.xyz`
  (reading results), `state.forward.computer`, HyperBEAM peers,
  `alpha.neo.zephyrdev.xyz` and `charlie.neo2.zephyrdev.xyz` (token
  balances, and posting a signed transaction the gateway can't take).
  Balance and collectible reads fail over to the other enabled peers:
  a shipped community list and nodes discovered daily from on-chain
  location records (`core/ao/peer-discovery.ts`).
- **Gleam:** `api.gleamwallet.app` (prices: the token id only, relayed to
  CoinGecko and CoinPaprika; Gleam Points: the wallet address, a signed
  proof of ownership, and a device id) and `gleamwallet.app`
  (announcements, the newest release per shell, and the extension's
  welcome and uninstall pages).
- **Vault backup, when on:** `www.googleapis.com` (Google Drive, in the
  extension and on Android) and CloudKit (iOS). They see the encrypted
  file and the account it belongs to.

Pages in the app's dApp view load whatever they load, as in a browser
tab; that traffic is the dApp's, not the wallet's.

The extension's content security policy (`apps/extension/src/csp.ts`)
and the app's (`apps/mobile/index.html`) limit `fetch` and other
connections to `https:`, but not to a host list (see
[By design](#by-design)).

No key, password or seed ever leaves the device unencrypted. Addresses
do: every gateway sees the addresses it is asked about.

## By design

Gleam follows **informed security** for the choices it leaves to the
user. It defaults to the stronger guarantee, and the user may turn it
off once they've been told the risk. Such a setting is not a finding in
itself. It becomes one if the user isn't told, can't see the current
setting, or the setting can change without them.

Auto-lock is such a setting. The other entries are fixed trade-offs,
each with its own reason. Only what an entry names is by design; any
other weaker option is open to report.

Each entry gives the decision, why it was made, and what would still
count as a finding.

- **Auto-lock can be set to "never".** Some users keep the wallet open
  all day. A new install defaults to 1 hour, and the extension's vault
  also locks when the computer's screen locks. "Never" turns off both.
  While it is selected, Settings → Security shows "Gleam stays
  unlocked always even when your computer locks." in the extension and
  "Gleam stays unlocked always." in the app, and the Settings list shows
  the current timeout. Only Gleam's own screens can change it
  (`setLockSettings` is extension-tier in
  `packages/runtime/src/dispatch/methods.ts`). A vault with no stored
  timeout reads as 1 hour, and an update never writes one. A vault holding
  only hardware wallets has no password, so it never locks.
  *Still a finding if,* by any path, a web page, a dApp view page, a
  content script, a link or a message from outside Gleam's own screens
  changes the timeout; the setting changes on update; a vault holding a
  password-encrypted key stays usable past the chosen timeout, or, in
  the extension, past a screen lock with any timeout other than "never".
- **The password policy is a minimum length and a blocklist.** The
  vault password must be at least 12 characters and not one of about
  160 common passwords, matched case-insensitively
  (`packages/core/src/vault/password-policy.ts`). There are no
  character-class rules, which push users toward predictable patterns.
  Argon2id makes each guess against a stolen vault or backup slow, but a
  reused or predictable password can still be guessed. The runtime
  checks the policy when the first wallet sets the vault password. Later
  wallets must open the existing vault with the same password instead.
  *Still a finding if,* by any path (the UI, a direct call to the
  runtime, an import, a restore), a vault ends up protected by a
  password shorter than 12 characters or on the blocklist; or a new
  envelope is written with weaker parameters than the Argon2id ones
  under "How the key is kept".
- **Key export saves an unencrypted keyfile once the password is
  given.** A standard keyfile is what every other Arweave wallet
  imports. Export asks for the vault password even while unlocked, and
  the screen warns that the file isn't password-protected. Hardware
  wallets have no keyfile to export.
  In the extension, the background decrypts the keyfile and saves it
  through `chrome.downloads` itself, so the plaintext never crosses
  messaging to the popup. Chrome keeps a download's `data:` URL in its
  history, so the background erases that row once the download settles
  (`apps/extension/src/adapters/downloads.ts`).
  In the app, the runtime worker hands the file to the wallet WebView,
  which writes it to its own folder in the app's cache (never backed
  up, and the only folder Android's `FileProvider` shares), opens the
  share sheet, and deletes the folder once the sheet closes; leftovers
  from a killed app are swept on the next start
  (`apps/mobile/src/adapters/file-saver.ts`). The app the user picks in
  the share sheet receives the plaintext keyfile.
  *Still a finding if,* by any path, the plaintext keyfile is saved or
  returned without the correct password; it reaches the popup, a
  content script, a page or the dApp view; a page can make Gleam save
  it; the extension's download history row still holds the key after
  the download completes or is cancelled; or the app's copy outlives
  the share sheet past the next start.
- **Plain `http://` is allowed on loopback.** Developers run dApps on
  `http://localhost`, and loopback traffic never crosses the network.
  Every page method but `disconnect`, reads and `connect` included, is
  refused for a plain-http origin unless its hostname is exactly
  `localhost`, `127.0.0.1` or `[::1]` (`isSecureSigningOrigin` in
  `packages/core/src/policy/signing-origin.ts`, checked on every call in
  `packages/runtime/src/create-runtime.ts`), so a grant made
  before a site lost https reads nothing. The app's dApp view can show
  a plain-http page, marked insecure in the address bar, and the same
  rule refuses its calls.
  *Still a finding if,* by any method, a plain-http origin with any
  other hostname, such as `foo.localhost`, a LAN address or a public
  host, connects, reads an address or balance, or opens an approval.
- **`privateHash` is refused.** Wander's `privateHash` digests the
  private key itself. Gleam's unlocked keys are non-extractable, so it
  can't compute one, and handing sites a value derived from the key is
  a risk with no matching need: `encrypt`, `decrypt` and `signMessage`
  cover its uses. Every site gets the same error, before any grant
  check, and no approval opens (`REFUSED_PROVIDER_METHODS` in
  `packages/core/src/models/method-privileges.ts`).
  *Still a finding if,* by any path, `privateHash` resolves, or any
  provider method returns a value derived from private key material
  other than a signature or decryption the user approved.
- **A connection belongs to the site, not to one wallet.** As in Wander,
  and as the `walletSwitch` event dApps rely on expects, a site's grant
  follows the active wallet. After the user switches to or imports
  another wallet, a site with "See your address" reads the new active
  address and can ask it for signatures, each in its own approval that
  names the wallet that signs. `grant.walletId` only records which
  wallet approved the connection (`GrantedCall` in
  `packages/runtime/src/handlers/provider.ts`). A user who keeps wallets
  apart disconnects the site before switching.
  *Still a finding if,* by any path, a site without "See your address"
  learns any address other than from a signature the user approved (see
  the next entry); a site with only "See your address" learns the
  address of a wallet that wasn't active while it was connected, or the
  list of wallets that "See all your wallets" covers; or an approval names
  a different wallet from the one that signs.
- **A signature tells the site which wallet signed.** A signed
  transaction or data item carries the signer's public key, and the
  address is its hash. So `sign`, `signDataItem` and `batchSignDataItem`
  hand a site the signing wallet's address once the user approves, even
  without "See your address". Every Arweave wallet does the same: a
  signature can't be checked or posted without its owner, and the
  approval names the wallet that signs.
  *Still a finding if* a site learns an address without a signature the
  user approved, or a signed result carries a different wallet's key
  from the one the approval named.
- **A connected site can ask whether a token is in the wallet's list.**
  `addToken` and `isTokenAdded` need a connection and no other
  permission, as in Wander. `isTokenAdded` answers one process id at a
  time from the local watched list, which also holds tokens the wallet
  discovered itself, and token balances are public on-chain.
  *Still a finding if* a site without a grant gets an answer, or any
  call returns the list, a balance or anything beyond that one bit.
- **The deprecated `signature` is refused.** Wander's `signature` signs
  RSA-PSS straight over the bytes a site passes, with a salt length the
  site picks. A site that passes a hash it computed gets a signature
  equal to `signMessage` over a message, or to a transaction or data item
  signature, that no preview can decode, including a Gleam Points proof
  `signMessage` refuses. It is refused the same way as `privateHash`.
  *Still a finding if,* by any path, a page gets an RSA-PSS signature
  over bytes it chose without Gleam hashing or encoding them itself.
- **The content security policy limits connections and scripts, not
  hosts.** `connect-src` is `https:`, scheme-wide rather than a host
  allowlist, because users add their own gateways and HyperBEAM peers at
  runtime, and images load from any https URL for token logos and NFT
  thumbnails. Code running inside Gleam can therefore reach any https
  host, and an image URL can carry data out.
  The extension (`apps/extension/src/csp.ts`) sets `script-src 'self'
  'wasm-unsafe-eval'`, `object-src 'none'`, `base-uri 'none'` and
  `connect-src https:`, and leaves `default-src` unset, so image, font
  and frame sources are unrestricted.
  The app (`apps/mobile/index.html`) sets `default-src 'self'`, the same
  `script-src`, `object-src`, `base-uri` and `connect-src`, `img-src
  'self' https: data: blob:`, `frame-src 'none'` and `form-action
  'none'`.
  *Still a finding if,* by any path, code from a remote source runs in
  an extension page, the service worker, the wallet WebView or the
  runtime worker, or Gleam sends or receives wallet data over a
  non-https connection (for example through a production `connect-src`
  that permits a non-https scheme, or a `script-src` that permits a
  remote source).
- **Dependency advisories that touch only development tools.** Each
  package below either has no patched release, or has one only in a major
  version that the dependent pulling it in doesn't accept.
  `osv-scanner.toml` ignores each advisory until 2027-04-16 unless noted,
  so the scan fails again and the entry is re-checked. Every Gleam
  signature is RSA-PSS through WebCrypto (`core/signer/keys.ts`,
  `core/arweave/rsa-pss.ts`).
  - `elliptic` ≤ 6.6.1 (GHSA-848j-6mx2-7j84): faulty ECDSA nonces can
    leak the signing key. It enters the lockfile through
    `@dha-team/arbundles` (`@ethersproject/signing-key`, `secp256k1`), a
    devDependency of `packages/core` whose tests use it to cross-check
    our ANS-104 encoding, and through `vite-plugin-node-polyfills`'
    `crypto-browserify`, which the build doesn't include (only `stream`
    and `events` are polyfilled). A production build contains no
    elliptic code: its curve constants, error strings and `HmacDRBG` are
    absent from `.output/chrome-mv3`.
  - `minimatch` (GHSA-g3hv-75wg-m249): fixed only in 11.0.1, a major that
    `eslint` and `typescript-estree` don't accept. It reaches only lint and
    `web-ext` tooling, which match the repository's own globs, and isn't
    in the build. Its ignore runs until 2027-01-31.
  - `glob` (GHSA-3g3m-2fjr-6pw4): fixed only in 14.0.2, a major that
    `rimraf` doesn't accept. It reaches only `@capacitor/cli` at build
    time, which passes `rimraf` no `AbortSignal`, and isn't in the build.
    Its ignore runs until 2027-01-31.

  *Still a finding if,* by any path, `.output/chrome-mv3` or
  `apps/mobile/dist` contains code from any of these packages, or
  shipped code signs or verifies with ECDSA or PKCS#1 v1.5, so the
  advisory's harm reaches users; or a patched version that the
  dependent accepts exists for any of them, which ends the ignore.

## Known limitations

These are true of the current release.

- **Hardware wallets sign only part of the API.** Ledger signs AR
  transactions, and data items (AO sends, `signDataItem`) only on the
  beta Permaweb app: the stock Arweave app has no data-item command, and
  the Ledger panel refuses a data item on it. `dispatch` stays on L1 for
  Ledger, and it signs no messages. Keystone signs transactions, data
  items and messages. Neither decrypts or exports, since the key stays on
  the device (`core/models/capabilities.ts`). The app supports Keystone
  only.
- **Leaving the app or locking the phone doesn't lock Gleam.** Only
  auto-lock does, after the chosen time without use, and the app's Lock
  settings say only that. While the OS has the app suspended, its
  JavaScript doesn't run, so unlocked keys stay in the worker's memory
  past the timeout until the app resumes, when the missed check locks
  before anything reads a key, or until the OS ends the process.
- **On Android, a dApp page and the wallet share one renderer process.**
  Android WebViews in an app run in a single renderer process, across
  WebView instances and profiles. A renderer exploit in a page loaded in
  the dApp view could therefore reach the memory of the wallet WebView.
  Isolating them would need the dApp view in its own process, for example
  a separate Activity with `android:process`. Accepted for now. The
  separate profile still keeps cookies and storage apart, and the dApp
  view doesn't open on a WebView without `MULTI_PROFILE`.
- **Android 8 to 11 deliver taps through other apps' overlays.** The app
  doesn't set `filterTouchesWhenObscured`, so an app holding the
  draw-over-other-apps permission could cover the approval sheet and
  pass the user's taps through to Approve. Android 12 and later drop
  such taps unless the overlay is mostly transparent.
- **iOS allows screenshots of the import screens.** The privacy screen
  is on only while a keyfile or recovery phrase is being imported. On
  Android it sets `FLAG_SECURE` (no screenshots, a blank recents card);
  on iOS it covers only the app switcher, since blocking screenshots
  needs an unofficial window-layer change
  (`apps/mobile/src/adapters/secure-screen.ts`).
- **Pending figures trust the nodes Gleam ships with.** A token node's
  2xx is taken as accepted with no gateway confirmation. The first node
  to answer sets `swap-height`, so a lying node can clear a pending
  deduction early. A `+N arriving` note shows the amount the sender
  chose until the token applies or drops it. Pending AR sends leave out
  the fee and can count twice between mining and the next activity read.
  None of these changes what is signed, and a send above the real
  balance is refused by the network or the token. The worst case is a
  send that reads pending, then failed after 2 hours, with nothing moved.
- **Failover peers are not vetted.** When the active HyperBEAM peer is
  down, token balance and collectible reads try up to two more enabled
  peers, including community nodes and ones announced in on-chain
  location records, which anyone can publish. Such a node sees the
  wallet address and could answer a wrong balance or list collectibles
  the wallet doesn't hold. Discovered URLs must be bare public https
  origins that answer as a node. What is signed never depends on their
  answers: a wrong balance can misstate the balance and balance-after
  lines or block a send as over the balance, and a send above the real
  balance is refused by the token. A user can remove any peer in
  Network & peers.
- **Prices are display only.** A lying node can post a collectible
  listing at any price above 0.1 AR, and a wrong FX rate from the Points
  API misstates a fiat figure. Neither feeds a signature or a send, which
  are typed and checked in token units.
- **A dApp's L1 token transfer can lose its quote.** If the token host
  hangs past 10 seconds, the transfer is refused after approval. No
  funds are at risk.
- **Translated errors match whole messages.** `matchUserError` shows the
  translated sentence for any message equal to a template. AO process
  errors never reach `errorText`, and a placeholder can't change the
  sentence around it.
- **Translations are machine-written.** Chinese, Korean, Japanese,
  Spanish, Portuguese, Turkish, Vietnamese, Russian and Indonesian
  approval and recovery text has been spot-checked but not reviewed by
  a native speaker. Decoded transaction data, addresses and tag values
  are never translated.
- **The stored query cache is plaintext.** Anyone with access to the
  browser profile or the app's storage can read balances and activity
  without unlocking. It holds no key material.
- **An APK install can't update to the Play Store build.** The APK is
  signed with the upload key and Play installs with the Play signing
  key, so moving over means uninstalling, which deletes a vault that
  isn't backed up.
- **App link and dApp-view gaps.**
  - A `target=_blank` or `window.open` from a cross-origin iframe takes
    the main-frame path for an external-app link, so the "Open in another
    app?" prompt can carry page-chosen text. The user still has to tap
    Open, and the prompt names the site.
  - An attest link opened while the app is locked is held, and shows as
    an approval sheet after the next unlock, with the usual decoded
    preview.
  - The approval sheet doesn't wait for the native dApp view to hide.
    The view sits above the sheet, so it would take the tap, not approve.
  - An invite link redeems its code with no tap. It signs nothing; the
    extension's site message works the same way.
- **The Swift CodeQL job runs without `harden-runner`.** It doesn't
  support macOS runners on the community tier.
- **Points and scans.**
  - `GET /scan/challenge` writes one row per call, bounded by 30 per
    hour per IP and a purge 24 hours after expiry.
  - Rate limits key on the first `X-Forwarded-For` entry, which holds
    only while the API sits behind Railway's edge.
  - One wallet scans each area of a release once and a release pays
    1 to 100 scans (at least 50 for an `x.y.0`), so many registered
    wallets can still take the paid places.
  - `GET /attestations` publishes each attestation's owner key,
    signature, report and answers, so anyone can verify without trusting
    Gleam.
  - The scan CLI prints server-supplied error text into an agent's
    context, constrained by the parser's patterns.
  - `gleam-points:attest-status` tells `gleamwallet.app` whether a wallet
    is set up and has joined Points on this install, without an address.
  - A member invite code's 3 seats go to the first 3 devices that redeem
    it, and a device key costs nothing to make, so anyone holding the
    link can use up its seats. It moves no funds and signs nothing.
- **No independent audit has been completed.**

## Out of scope

- A compromised operating system or browser, including a rooted or
  jailbroken phone.
- A user who gives away their keyfile or password.
- The security of AO processes, tokens or dApps the user chooses to use.
- Other extensions with broad permissions reading or changing pages.

## The security surface

[`security/surface.txt`](../security/surface.txt) lists every file where a
bug could leak a key, produce an unapproved signature, or let a page past
the wallet's boundary, ranked by impact, for both shells. It is the scope
for audits and security review. The release gate
(`scripts/release-gate.mjs`) refuses to tag a release while any of those
files has changed since the last audit (`security/audits/README.md`).
