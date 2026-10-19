# Gleam threat model

Gleam is a Chrome extension wallet for Arweave and AO. This document
describes what it protects, who it protects against, how, and where the
protection stops. It describes the current code. Deliberate trade-offs
are listed under [By design](#by-design), and gaps under
[Known limitations](#known-limitations), rather than left out.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What Gleam protects

1. **The keyfile.** An Arweave RSA-4096 key (JWK). Whoever has it controls
   the wallet's AR, AO tokens and collectibles, permanently.
2. **The user's consent.** Nothing is signed, decrypted or sent unless the
   user approved that exact request.
3. **Privacy.** Which sites the user connects to, and which addresses
   belong to the same person.

## Architecture and trust boundaries

```text
 web page (untrusted)
   └─ provider script        page world; exposes window.arweaveWallet
        │ postMessage
   └─ content script         isolated world, top frame only
        │ runtime messaging — Chrome attaches the sender
 background service worker   trusted; holds unlocked keys, signs
        │ runtime messaging
 extension pages             trusted; popup, side panel, approval window,
                             passkey window
```

- **The background decides who is asking from Chrome's `sender`, never
  from the message body.** A content script can send only `providerCall`
  (plus two read-only questions about its own tab). Every other method,
  including key export, wallet creation and approving requests, is
  accepted only from the extension's own pages (`isExtensionPageSender`
  in `apps/extension/src/sender.ts`).
- **A page's origin is the origin Chrome reports for the sending frame.**
  Only the top frame counts. Iframes never get the content script, and a
  sandboxed document with an opaque origin is refused.
- **A page can reach a fixed list of methods** (`PROVIDER_SURFACE_METHODS`
  in `packages/messaging/src/page-protocol.ts`), disjoint from the key and
  approval methods. Anything else is rejected before a handler runs.
- **A site must be connected before it can read anything**, and `connect`
  itself needs the user's approval. Connections can be revoked in
  Settings → Connected apps.

## How the key is kept

**At rest.** The keyfile is encrypted with AES-256-GCM under a key derived
from the user's password by Argon2id (64 MiB, 5 passes, parallelism 1,
16-byte random salt, 12-byte random IV). The ciphertext is bound to its
wallet record by additional authenticated data
(`gleam:v2:<walletId>:<address>`), so an envelope moved onto another
wallet's record fails to decrypt. It is stored in `chrome.storage.local`.
The derived key is a non-extractable WebCrypto key, and the password bytes
and the raw Argon2id output are zeroed after use. A PBKDF2-HMAC-SHA256
(v1, 600,000 iterations) envelope still opens, and unlocking re-encrypts
it with Argon2id. Stored Argon2id parameters are
bounded, so a corrupted envelope can't make the worker allocate gigabytes.
See `packages/core/src/signer/envelope.ts`.

**While unlocked.** Unlocking decrypts the keyfile and hands it, once,
to the keyring: an offscreen document the background opens for this
alone. The keyring imports it as non-extractable WebCrypto keys: one
RSA-PSS signing key per hash (SHA-256, SHA-384, SHA-512) and one RSA-OAEP
decryption key. They can sign and decrypt, but their bytes can't be
exported, and they exist only in the keyring's memory. Nothing
key-related is written to disk: not IndexedDB, which would store the key
material in the browser profile, and not `chrome.storage`. No code keeps
a reference to the decrypted JWK after the import, but the parsed copies
in the background and in the keyring stay in memory until garbage
collection, since JavaScript can't overwrite strings. Since no private
key material is readable while unlocked, `privateHash` is refused (see
[By design](#by-design)).

The keyring opens one port to the background and reopens it whenever the
service worker restarts. The background accepts that port only from the
keyring document, judged by Chrome's sender (extension id, page URL, no
tab, offscreen document id), and disconnects any other page that
connects under the keyring's name. What the background posts on the port
reaches only the keyring, so the JWK goes nowhere else. What the keyring
posts back, signatures and decrypted plaintexts, reaches every extension
page listening for connections, and such a page could also send the
keyring requests. No Gleam page listens; a compromised one is the
"compromised extension code" case below: it can get signatures and
decryptions while the wallet is unlocked, never the key.

`chrome.storage.session` holds only the address, the public key and
which wallets are unlocked. That storage lives in memory only, is
cleared when the browser closes, and is not readable by content scripts
or web pages. A wallet counts as unlocked only while the session lists
it and the keyring holds its key; if the keyring document is gone, the
wallet reads as locked. Lock, auto-lock, wallet removal, reset and
browser startup clear the keyring and close its document. Locking
overwrites each session entry before removing it. Auto-lock is checked
on every key read and by a one-minute alarm, so the keys go when the
timeout passes even if nothing reads them. The timeout counts from the
last time a Gleam page (popup, side panel or approval window) loaded the
wallet state; a connected site's calls don't extend it. New installs
default to 1 hour. The vault also locks when the computer's screen locks, unless
auto-lock is set to "never" (see [By design](#by-design)). Lock and
unlock run one at a time, so a lock can't race an unlock and leave keys
behind. See
`apps/extension/src/handlers/key-session.ts` and
`apps/extension/entrypoints/keyring/`.

**Passkey unlock.** A passkey's WebAuthn PRF output wraps the vault
password. Unlocking with a passkey recovers the password and then unlocks
exactly as typing it would. The relying party is the extension's own id.

**Hardware wallets.** Keystone and Ledger wallets keep the key on the
device. Gleam stores only the public key and address.

## Signing and approvals

- **Every signing, decryption and transfer request from a site opens a
  separate Gleam window** (a Chrome popup window, not part of the page)
  with a preview decoded from the request.
- **The window can't change what gets signed.** It returns only the
  request id and approve or reject. The background signs its own stored
  copy of the request, so the preview and the signed bytes come from the
  same object.
- **Gleam Points payloads are refused from sites.** A `signMessage`
  whose data starts with `gleam-points:`, and a `sign` or `dispatch`
  with a `Gleam-Points` tag, are refused before any window opens
  (`apps/extension/src/dispatch/methods.ts`). The tag refusal adds to
  how a hardware proof is built (`core/points/ownership.ts`), which
  already keeps a site's transaction from matching one.
- **There is no auto-approval.** No setting lets a site sign without the
  window.
- **Requests expire.** An unanswered request is rejected after 5 minutes
  (20 for a scan attestation from the Gleam site, 15 for hardware wallets
  waiting on the device).
- **AO messages are built and signed with plain WebCrypto**
  (`packages/core/src/ao/transfer.ts`). No third-party library touches
  the key on the signing path.

## Attackers

| Attacker | What they try | What stops them | What's left |
| --- | --- | --- | --- |
| Malicious website | Read addresses, sign or send without consent, reach key methods | Connect approval; per-request approval window; fixed method list; origin from Chrome's sender | A user approving a request they don't understand. The preview is the defense. |
| Phishing site or fake popup drawn in a page | Trick the user into typing the password or approving | Real requests always open a separate browser window; Gleam never asks for the password inside a page | Users who don't know the rule. |
| Network attacker | Inject requests into a page, tamper with data | Extension code ships in the package, never fetched; HTTPS for all extension traffic; plain-`http://` sites can't connect, read or request a signature, except `localhost`, `127.0.0.1` and `[::1]` | Loopback `http://` stays allowed for local development; its traffic never crosses the network. |
| Compromised npm dependency | Read the unlocked key and send it out | Locked dependency versions; new releases held back 3 days; provenance downgrades refused; dependency PRs reviewed by CI | Code running inside the extension can ask for signatures and decryptions while the wallet is unlocked, and can reach any https host or load an image from any URL. It can't copy the key: unlocked keys are non-extractable. The largest open risk. |
| Hijacked Chrome Web Store account | Push a malicious update to every user | The developer account's own login protection | No signed-upload requirement yet, so the account alone can publish. Planned: verified CRX uploads, which need an offline signing key. |
| Hijacked GitHub account or token | Change the source or CI | 2FA; protected `master`: signed commits, PR with passing CI, no force-push, no admin bypass | An account takeover can change the rules. |
| Malware on the user's computer | Copy the vault, log keystrokes | Encrypted vault; unlocked keys in memory only, cleared on lock | Malware that can read browser memory or keystrokes wins; no browser wallet can stop it. A stolen vault can be attacked offline: see the password policy under By design. |
| Someone at an unlocked browser | Send funds, export the key | Export needs the password; sends need confirmation | Auto-lock is 1 hour by default; the user can choose "never", with a warning. |
| Compromised gleamwallet.app | Message the extension, show announcements | The site can only hand over a points invite code; announcement links are limited to the Gleam site and x.com; a production build accepts site messages only from `https://gleamwallet.app` (`isSiteOrigin` in `apps/extension/src/dispatch/site.ts`) | Misleading announcement text. A development build also accepts them from any `http://localhost` or `http://127.0.0.1` page, so local pages can send a dev build invites and scan attestations. |
| Lying gateway, AO unit or price API | Show wrong balances, history or prices | Signed transactions are built locally from the user's own input | Wrong balances or history on screen; a dishonest gateway can drop a transaction. |

## Network

The extension talks to:

- **Arweave gateways:** `arweave.net` by default, a few fallbacks, or one
  the user sets. Used for balances, history (GraphQL) and posting
  transactions.
- **`up.arweave.net`:** the bundler, for uploads.
- **AO:** `mu.ao-testnet.xyz` (sending messages), `cu.ao-testnet.xyz`
  (reading results), `state.forward.computer` and HyperBEAM peers (token
  balances).
- **Gleam:** `api.gleamwallet.app` (prices: the token id only, relayed to
  CoinGecko and CoinPaprika; Gleam Points: the wallet address, a signed
  proof of ownership, and a device id) and `gleamwallet.app`
  (announcements, the welcome and uninstall pages).

The content security policy limits `fetch` and other connections to
`https:`, but not to a host list, and leaves image, font and frame
sources unrestricted (see [By design](#by-design)).

No key, password or seed ever leaves the device. Addresses do: every
gateway sees the addresses it is asked about.

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
  all day. A new install defaults to 1 hour, and the vault also locks
  when the computer's screen locks. "Never" turns off both. While it is
  selected, Settings → Lock & unlock shows "Gleam stays unlocked always,
  even when your computer locks", and the Settings list shows the
  current timeout. Only the extension's own pages can change it
  (`setLockSettings` is extension-tier in
  `apps/extension/src/dispatch/methods.ts`). On an extension update, a
  vault that has wallets but no stored timeout is set to "never", so
  its behavior doesn't change (`keepLockTimeoutOnUpdate` in
  `apps/extension/src/handlers/wallet-lifecycle.ts`). A vault holding
  only hardware wallets has no password, so it never locks.
  *Still a finding if,* by any path, a web page, content script or
  message from outside the extension's pages changes the timeout; the
  setting changes on update for a vault that already had one stored; or
  a vault holding a password-encrypted key stays unlocked past the chosen
  timeout, or past a screen lock with any timeout other than "never".
- **The password policy is a minimum length and a blocklist.** The
  vault password must be at least 12 characters and not one of about
  160 common passwords, matched case-insensitively
  (`packages/core/src/vault/password-policy.ts`). There are no
  character-class rules, which push users toward predictable patterns.
  Argon2id makes each guess against a stolen vault slow, but a reused or
  predictable password can still be guessed. The background checks the
  policy when the first wallet sets the vault password. Later wallets
  must open the existing vault with the same password instead.
  *Still a finding if,* by any path (the UI, a direct call to the
  background, an import), a vault ends up protected by a password
  shorter than 12 characters or on the blocklist; or a new envelope is
  written with weaker parameters than the Argon2id ones under "How the
  key is kept".
- **Key export saves an unencrypted keyfile once the password is
  given.** A standard keyfile is what every other Arweave wallet
  imports. Export asks for the vault password even while unlocked, and
  the screen warns that the file isn't password-protected. The
  background decrypts the keyfile and saves it through
  `chrome.downloads` itself, so the plaintext never crosses messaging
  to the popup. Chrome keeps a download's `data:` URL in its history, so
  the background erases that row once the download settles
  (`apps/extension/src/adapters/downloads.ts`). Hardware wallets have no
  keyfile to export.
  *Still a finding if,* by any path, the plaintext keyfile is saved or
  returned without the correct password; it reaches the popup, a content
  script or a page; a page can make the extension download it; or the
  download's history row still holds the key after the download
  completes or is cancelled.
- **Plain `http://` is allowed on loopback.** Developers run dApps on
  `http://localhost`, and loopback traffic never crosses the network.
  Every page method but `disconnect`, reads and `connect` included, is
  refused for a plain-http origin unless its hostname is exactly
  `localhost`, `127.0.0.1` or `[::1]` (`isSecureSigningOrigin` in
  `apps/extension/src/sender.ts`, checked on every call in
  `apps/extension/entrypoints/background/index.ts`), so a grant made
  before a site lost https reads nothing.
  *Still a finding if,* by any method, a plain-http origin with any
  other hostname, such as `foo.localhost`, a LAN address or a public
  host, connects, reads an address or balance, or opens an approval
  window.
- **`privateHash` is refused.** Wander's `privateHash` digests the
  private key itself. Gleam's unlocked keys are non-extractable, so it
  can't compute one, and handing sites a value derived from the key is
  a risk with no matching need: `encrypt`, `decrypt` and `signature`
  cover its uses. Every site gets the same error, before any grant
  check, and no window opens (`REFUSED_PROVIDER_METHODS` in
  `packages/core/src/models/method-privileges.ts`).
  *Still a finding if,* by any path, `privateHash` resolves, or any
  provider method returns a value derived from private key material
  other than a signature or decryption the user approved.
- **The content security policy limits connections and scripts, not
  hosts or images.** `apps/extension/src/csp.ts` sets `script-src 'self'
  'wasm-unsafe-eval'`, `object-src 'none'`, `base-uri 'none'` and
  `connect-src https:`. `connect-src` is scheme-wide rather than a host
  allowlist because users add their own gateways and HyperBEAM peers at
  runtime. `default-src` is deliberately unset so remote images (token
  logos, NFT thumbnails) stay unrestricted, which leaves image, font and
  frame sources open too. Code running inside the extension can
  therefore reach any https host, and an image URL can carry data out.
  *Still a finding if,* by any path, code from a remote source runs in
  an extension page or the service worker, or the extension sends or
  receives data over a non-https connection (for example through a
  production `connect-src` that permits a non-https scheme, or a
  `script-src` that permits a remote source).
- **Dependency advisories that touch only development tools.** Neither
  package below has a patched release. `osv-scanner.toml` ignores each
  advisory until 2027-04-16, so the scan fails again and the entry is
  re-checked. Every Gleam signature is RSA-PSS through WebCrypto
  (`core/signer/keys.ts`, `core/arweave/rsa-pss.ts`).
  - `elliptic` ≤ 6.6.1 (GHSA-848j-6mx2-7j84): faulty ECDSA nonces can
    leak the signing key. It enters the lockfile through
    `@dha-team/arbundles` (`@ethersproject/signing-key`, `secp256k1`), a
    devDependency of `packages/core` whose tests use it to cross-check
    our ANS-104 encoding, and through `vite-plugin-node-polyfills`'
    `crypto-browserify`, which the build doesn't include (only `stream`
    and `events` are polyfilled). A production build contains no
    elliptic code: its curve constants, error strings and `HmacDRBG` are
    absent from `.output/chrome-mv3`.
  - `node-forge` ≤ 1.4.0 (GHSA-86w9-cpqp-85rv): forged RSA PKCS#1 v1.5
    signatures. It comes only through `wxt` → `web-ext` → `adbkit`, a
    development tool, and isn't in the build.

  *Still a finding if,* by any path, `.output/chrome-mv3` contains code
  from either package, or shipped code signs or verifies with ECDSA or
  PKCS#1 v1.5, so the advisory's harm reaches users; or a patched
  version of either package exists, which ends the ignore.

## Known limitations

These are true of the current release.

- **Hardware wallets sign only part of the API.** Ledger signs AR
  transactions only: the Ledger Arweave app has no data-item command, so
  AO sends and `signDataItem` are off. Keystone signs transactions, data
  items and messages, but not `signature()`, which needs raw bytes
  signed. Neither decrypts or exports, since the key stays on the device
  (`core/models/capabilities.ts`).
- **No independent audit has been completed.**

## Out of scope

- A compromised operating system or browser.
- A user who gives away their keyfile or password.
- The security of AO processes, tokens or dApps the user chooses to use.
- Other extensions with broad permissions reading or changing pages.

## The security surface

[`security/surface.txt`](../security/surface.txt) lists every file where a
bug could leak a key, produce an unapproved signature, or let a page past
the wallet's boundary, ranked by impact. It is the scope for audits and
security review. The release gate (`scripts/release-gate.mjs`) refuses to
tag a release while any of those files has changed since the last audit
(`security/audits/README.md`).
