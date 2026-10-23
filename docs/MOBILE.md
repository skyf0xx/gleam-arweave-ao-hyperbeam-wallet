# Gleam on mobile

This document is the plan and spec for running Gleam on phones. It covers
which surfaces ship, what each one is for, how they share code, and the
security model for each. Each choice is stated with its reasoning.

## Goals

1. **dApp signing on mobile** without asking dApps to change anything.
2. **Daily wallet use on mobile**: check balances, send and receive, view
   activity, manage tokens and contacts.
3. **One codebase.** Platform code is limited to adapters and packaging.

## Non-goals

- **A dApp connector SDK.** dApps code against the ArConnect-style
  `window.arweaveWallet` API, and many embed a specific wallet SDK such as
  Wander Connect. Asking each dApp to adopt a Gleam SDK does not scale, so
  dApp signing on mobile comes only from browser extensions that inject
  the provider, exactly as on desktop.
- **dApp connectivity in the PWA.** The PWA has no provider, connect flow,
  connected-apps screen or dApp approval window. This keeps its attack
  surface to the wallet itself.
- **Key sync between surfaces.** Each surface holds its own vault. See
  [Vaults](#vaults).

## Surfaces

| Surface | Daily use | dApp signing | Platform |
|---|---|---|---|
| Chrome extension | Yes | Injected provider | Desktop Chrome and Chromium browsers |
| Firefox extension | Yes | Injected provider | Firefox for Android, Firefox desktop |
| iOS app with Safari Web Extension | Yes, in the container app | Injected provider in Safari | iPhone, iPad |
| Android app | Yes | None | Android |
| PWA | Yes | None | Any modern browser |

### Firefox extension

Firefox for Android installs any extension listed on addons.mozilla.org.
It runs the existing content script and provider unchanged, so every dApp
opened in Firefox for Android sees `window.arweaveWallet`. It is the
cheapest target and it forces the cross-browser adapter work that Safari
needs too, so it ships first.

### iOS app with Safari Web Extension

Safari on iOS 15+ runs Web Extensions, including MV3, packaged inside a
native App Store app. The extension injects the provider into every page
in Safari, including dApps that embed another wallet's SDK.

The container app is also the daily-use wallet on iOS. It is preferred
over a PWA on iOS because:

- Its code is a signed, reviewed binary. Nothing is loaded from a server.
- The vault is stored in the Keychain and its unlock can be gated by Face
  ID through Secure Enclave access control.
- Safari can evict website storage. An app container's storage is not
  evicted.
- The app and its extension can share an App Group and keychain access
  group, which allows one vault for both. See [Vaults](#vaults).

The UI is the existing React UI, bundled as local assets and loaded in a
`WKWebView` (Capacitor). It is never loaded from a URL.

App Store Guideline 3.1.5 requires a crypto wallet app to be published by
an organization developer account.

### Android app

Chrome for Android has no extension support. The Android app is the same
Capacitor shell as the iOS container app, with the vault in the Android
Keystore. It gives Android the same code-signing guarantee as iOS: updates
reach users only through a signed Play Store release.

### PWA

The PWA is the zero-install wallet for daily use in any browser. It is a
convenience surface for everyday balances. Users holding significant funds
are directed to an extension or a native app, because a web app's code
comes from its host on every load. See [PWA hosting and
integrity](#pwa-hosting-and-integrity).

## Architecture

The repository is already split along the right line: `packages/core` is
pure domain logic behind ports, and `packages/messaging` holds the typed
wire contracts. Mobile adds one package and one adapter set per platform.

```text
packages/core            domain logic (unchanged)
packages/messaging       ProtocolMap contracts (unchanged)
packages/ui              tokens, primitives, shared components
packages/wallet-runtime  handlers + dispatch, written against ports only
apps/extension           WXT targets: chrome-mv3, firefox-mv3, safari-mv3
apps/mobile              Capacitor shell for iOS and Android
apps/pwa                 Vite build of the wallet UI + runtime
```

### `packages/wallet-runtime`

`apps/extension/src/handlers/` and `apps/extension/src/dispatch/` move into
`packages/wallet-runtime`. Handlers that call `chrome.*` directly today
(`wallet-lifecycle`, `approval`, `key-session`) get that access through
ports instead. The runtime takes a port bundle and returns a dispatcher:

- **Extensions** run the dispatcher in the background context, as today.
- **The native apps and the PWA** run it in-process, in a Web Worker, so
  unlocked keys stay off the UI thread.

The dispatch table in `src/dispatch/methods.ts` already marks each
method's caller tier. Builds without dApp connectivity (native apps, PWA)
exclude every page-tier method and the handlers only they use
(`provider-params`, `site-wallet`, `approval`'s dApp path).

### Ports

| Port | Extension | Native app | PWA |
|---|---|---|---|
| Storage | `chrome.storage.local` | App Group container / app storage | IndexedDB |
| Session keys | `chrome.storage.session` | In-memory in the runtime worker | In-memory in the runtime worker |
| Approvals | Window (Chrome), tab (Firefox, Safari) | In-app confirm screen | In-app confirm screen |
| Unlock | Password, passkey (Chrome) | Password, biometrics | Password, passkey |
| Downloads | `chrome.downloads` | Share sheet | `<a download>` |
| Alarms | `chrome.alarms` | Foreground timer + app resume | Foreground timer + visibility change |

### Platform gaps in the extension targets

- **Approval windows.** Mobile browsers have no popup windows, so
  `adapters/windows.ts` opens approvals as tabs on Firefox and Safari.
- **Side panel.** Not available on Firefox for Android or Safari on iOS.
  The `sidepanel` entrypoint is excluded from those builds.
- **Offscreen keyring.** `adapters/offscreen-keyring.ts` uses Chrome's
  offscreen documents API. Firefox's event page has a DOM and does that
  work directly. Safari's support is confirmed before the Safari target
  ships.
- **Passkey unlock.** The WebAuthn RP id is the extension id, which works
  only on Chrome. Firefox uses a random `moz-extension://` UUID per
  install. Passkey unlock is disabled on Firefox and Safari. The iOS
  container app provides biometric unlock instead.
- **Background lifetime.** iOS stops extension backgrounds aggressively.
  Unlocked keys live in session storage and survive restarts, but
  auto-lock and the one-minute activity-settle alarm are tested on device.
- **Popup layout.** The popup UI fits a phone-width sheet as well as the
  fixed desktop popup.

## Vaults

Each surface keeps its own encrypted vault, because extensions, apps and
web origins cannot share storage. The vault format is the existing
envelope (Argon2id, AES-256-GCM, bound to the wallet record by AAD) on
every surface.

- **Moving a wallet** between surfaces uses the existing keyfile import,
  or an encrypted export file protected by the vault password.
- **The UI shows** which wallets this surface holds.
- **On iOS**, the container app and the Safari extension share one vault
  through an App Group and keychain access group. The extension's JS
  reaches it with `browser.runtime.sendNativeMessage` to the native
  handler. If the shared path proves unreliable on device, each keeps its
  own vault in native storage.
- **Biometric unlock** on iOS and Android gates the vault password in the
  Keychain or Keystore, so it unlocks exactly like the password, matching
  how passkey unlock wraps the password on desktop.

## PWA hosting and integrity

### Risk

A web app runs whatever code its origin serves on each load. Anyone who
can change what the PWA's URL serves can ship code that waits for the
password, decrypts the vault and sends the key away, to every user at
once. That includes a hosting or CDN breach, a DNS or domain hijack, a
compromised build pipeline or dependency, and anyone with deploy access.

### Model

The PWA is served from Arweave through an ArNS name.

- **Each release is an immutable Arweave transaction.** Its id commits to
  the content, so a release cannot be altered after publishing.
- **The ANT owner key controls updates.** Only its holder can point the
  ArNS name at a new release, which makes it the equivalent of a store
  publisher account. Every pointer change is on-chain and public.
- **The gateway is in the trust path.** The browser does not verify that
  the bytes a gateway serves match the transaction. The gateway is chosen
  deliberately: a reputable operator, or one Gleam runs.

The remaining gap compared with a store-signed binary is that there is no
review step, no staged rollout, and the gateway is trusted. This is
accepted for a convenience surface and is why the native apps are the
recommended mobile wallet.

### Controls

- **ANT key hygiene.** The ANT owner key is held on a hardware wallet or
  behind multisig. It is never on a server or in CI. Every release pointer
  change is signed by hand.
- **ArNS monitor.** A scheduled job alerts if the ArNS name points to a
  transaction that is not a published release.
- **Strict CSP and no third-party scripts**, which limits what injected
  code can load or where it can send data.
- **Reproducible builds.** Building a release tag produces byte-identical
  output to the deployed transaction.
- **Release records.** Each GitHub release lists its Arweave transaction
  id and build hash. Together with signed commits this gives a public
  chain from source to tag to transaction to ArNS record. Community scans
  can check that the deployed transaction matches the reproducible build.

### What is not built

- **A custom signed-update scheme** (a service worker that only accepts
  releases signed by a pinned key). The browser always fetches the service
  worker script from the network and lets the origin replace it, so the
  old worker cannot block a malicious update. It would only detect an
  attack, and the ArNS owner key plus the monitor already cover the update
  path.
- **User-facing verification** (in-app hash displays, "verified" badges).
  Code running on the channel being checked can display the same result,
  and users do not compare hashes. Verification is aimed at auditors
  through reproducible builds.

## Phases

1. **`wallet-runtime` extraction.** Move handlers and dispatch into the
   package and route their remaining `chrome.*` calls through ports. The
   Chrome extension runs on it with no behaviour change. Done when tests,
   tsc, eslint and `pnpm wxt:build` pass and a manual Chrome check is
   clean.
2. **Firefox target.** Add `firefox-mv3` to WXT, with approvals as tabs, no
   side panel, no offscreen document and passkey disabled. Publish to AMO.
   Verified on Firefox for Android against real dApps.
3. **iOS app and Safari extension.** Capacitor container app with the
   bundled UI and Keychain vault, plus the `safari-mv3` target packaged
   with Xcode. Confirm the shared vault path, offscreen support and
   background lifetime on device. Publish under an organization account.
4. **Android app.** The same Capacitor shell with the Android Keystore
   vault. Publish to the Play Store.
5. **PWA.** Vite build of the UI and runtime without dApp methods, hosted
   on Arweave through ArNS, with the controls listed above.

## Open questions

- Whether the Safari extension's native messaging to a shared App Group
  keychain is reliable enough to share one vault on iOS.
- Whether Safari on iOS supports the offscreen documents API, or the
  keyring work runs in the background page there.
- How Edge for Android's extension support develops. If it reaches stable
  with MV3, it becomes a fourth extension target with no new code.
