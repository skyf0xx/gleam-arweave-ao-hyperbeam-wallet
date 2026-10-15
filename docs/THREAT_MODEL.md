# Gleam threat model

Gleam is a Chrome extension wallet for Arweave and AO. This document
describes what it protects, who it protects against, how, and where the
protection stops. It describes the current code. Gaps are listed under
[Known limitations](#known-limitations) rather than left out.

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
from the user's password by PBKDF2-HMAC-SHA256 (600,000 iterations, 16-byte
random salt, 12-byte random IV). The ciphertext is bound to its wallet
record by additional authenticated data (`gleam:v1:<walletId>:<address>`),
so an envelope moved onto another wallet's record fails to decrypt. It is
stored in `chrome.storage.local`. The derived key is a non-extractable
WebCrypto key, and the password bytes are zeroed after use. See
`packages/core/src/vault/envelope.ts`.

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
collection, since JavaScript can't overwrite strings. Because no
private key material is readable while unlocked, Wander's `privateHash`,
which digests the private exponent's text, is refused.

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
which wallets are unlocked. That storage lives in memory only, is cleared when the browser closes, and is not readable by content
scripts or web pages. A wallet counts as unlocked only while the session
lists it and the keyring holds its key; if the keyring document is gone,
the wallet reads as locked. Lock, auto-lock, wallet removal, reset and
browser startup clear the keyring and close its document. Locking
overwrites each session entry before removing it. Auto-lock is checked on
every key read and by a one-minute alarm, so the keys go when the timeout
passes even if nothing reads them. Lock and unlock run one at a time, so
a lock can't race an unlock and leave keys behind. See
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
- **There is no auto-approval.** No setting lets a site sign without the
  window.
- **Requests expire.** An unanswered request is rejected after 5 minutes
  (15 for hardware wallets waiting on the device).
- **AO messages are built and signed with plain WebCrypto**
  (`packages/core/src/ao/transfer.ts`). No third-party library touches
  the key on the signing path.

## Attackers

| Attacker | What they try | What stops them | What's left |
| --- | --- | --- | --- |
| Malicious website | Read addresses, sign or send without consent, reach key methods | Connect approval; per-request approval window; fixed method list; origin from Chrome's sender | A user approving a request they don't understand. The preview is the defense. |
| Phishing site or fake popup drawn in a page | Trick the user into typing the password or approving | Real requests always open a separate browser window; Gleam never asks for the password inside a page | Users who don't know the rule. |
| Network attacker | Inject requests into a page, tamper with data | Extension code ships in the package, never fetched; HTTPS for all extension traffic; plain-`http://` sites can't connect or request a signature, except `localhost`, `127.0.0.1` and `[::1]` | Loopback `http://` stays allowed for local development; its traffic never crosses the network. |
| Compromised npm dependency | Read the unlocked key and send it out | Locked dependency versions; new releases held back 3 days; provenance downgrades refused; dependency PRs reviewed by CI | Code running inside the extension can ask for signatures and decryptions while the wallet is unlocked, and has no network restriction. It can't copy the key: unlocked keys are non-extractable. The largest open risk. |
| Hijacked Chrome Web Store account | Push a malicious update to every user | The developer account's own login protection | No signed-upload requirement yet, so the account alone can publish. Planned: verified CRX uploads, which need an offline signing key. |
| Hijacked GitHub account or token | Change the source or CI | 2FA; protected `master`: signed commits, PR with passing CI, no force-push, no admin bypass | An account takeover can change the rules. |
| Malware on the user's computer | Copy the vault, log keystrokes | Encrypted vault; unlocked keys in memory only, cleared on lock | Malware that can read browser memory or keystrokes wins; no browser wallet can stop it. A stolen vault can be attacked offline: see password strength below. |
| Someone at an unlocked browser | Send funds, export the key | Export needs the password; sends need confirmation | Auto-lock is off by default. |
| Compromised gleamwallet.app | Message the extension, show announcements | The site can only hand over a points invite code; announcement links are limited to the Gleam site and x.com | Misleading announcement text. |
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
- **Prices:** `api.coingecko.com`, `api.coinpaprika.com`.
- **Gleam:** `api.gleamwallet.app` (Gleam Points: the wallet address, a
  signed proof of ownership, and a device id) and `gleamwallet.app`
  (announcements, the welcome and uninstall pages).

No key, password or seed ever leaves the device. Addresses do: every
gateway sees the addresses it is asked about.

## Known limitations

These are true of the current release. Each has a fix planned unless it says otherwise.

- **No network allowlist.** The extension's content security policy
  doesn't restrict which hosts its code can contact, so stolen data
  could be sent anywhere. Planned: a `connect-src` allowlist.
- **Auto-lock is off by default.** Planned: on by default, and lock when
  the computer locks.
- **Password strength.** The minimum is 8 characters, with a blocklist of
  common passwords. Against a stolen vault, PBKDF2 slows guessing but
  doesn't stop a GPU attack on a weak password. Planned: Argon2id.
- **Key export passes the plaintext keyfile to the popup.** It's needed to
  save the file, and it requires the password.
- **Hardware wallets can't sign yet.** They can hold funds and receive.
- **Dependency advisories without a fix, not in the shipped extension.** No fix planned until upstream releases one.
  Neither package has a patched release.
  - `elliptic` ≤ 6.6.1 (GHSA-848j-6mx2-7j84): faulty ECDSA nonces can
    leak the signing key. It enters the lockfile through
    `@dha-team/arbundles` (`@ethersproject/signing-key`, `secp256k1`),
    which only `packages/core` tests import to cross-check our ANS-104
    encoding, and through `vite-plugin-node-polyfills`' `crypto-browserify`,
    which the build doesn't include (only `stream` and `events` are
    polyfilled). A production build contains no elliptic code: its
    curve constants, error strings and `HmacDRBG` are absent from
    `.output/chrome-mv3`. Every Gleam signature is RSA-PSS through
    WebCrypto (`core/vault/signer.ts`, `core/arweave/rsa-pss.ts`).
  - `node-forge` ≤ 1.4.0 (GHSA-86w9-cpqp-85rv): forged RSA PKCS#1 v1.5
    signatures. It comes only through `wxt` → `web-ext` → `adbkit`, a
    development tool, and isn't in the build.
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
security review. A release gate that blocks a release while any of those
files has changed since the last review is planned.
