# @gleam/mobile

This is the Gleam app for iOS and Android, built with Capacitor. Like
`apps/extension`, it is a composition root: it implements the packages'
interfaces with native and Capacitor APIs and wires them into the same
packages.

The app displays the same screens as the extension, arranged for a phone
screen. It also includes its own dApp browser, so that dApps can connect
to the wallet in the same way they do in Chrome.

## Structure

- **`src/main.tsx`**: starts the app and displays `@gleam/app` in its
  phone layout.
- **`src/app-platform.ts`**: the phone's `AppPlatform`, which connects
  the screens to the rest of the app.
- **`src/worker/`**: the app's background, where `@gleam/runtime` and the
  unlocked keys run separately from the screens.
- **`src/adapters/`**: the phone's versions of host services, such as
  storage, biometric unlock, the QR scanner, file saving and the dApp
  browser.
- **`src/provider/`**: the script the dApp browser adds to each page,
  built from `@gleam/provider`.
- **`plugins/dapp-view/`**: the native dApp browser for iOS and Android.
- **`ios/`, `android/`**: the native projects that Xcode and Android
  Studio open.

## Security model

- **Two WebViews.** The wallet WebView loads only the bundled assets. The
  dApp browser is a separate native view. It has no JS bridge to the
  wallet WebView, only the provider's message channel to native code.
- **Attested origin.** Native code passes on the sending frame's origin
  (`WKFrameInfo.securityOrigin` on iOS, `addWebMessageListener`'s
  `sourceOrigin` on Android) and whether it is the main frame. The plugin
  only relays. The TypeScript transport makes every decision, so scan
  challenges can reach it.
- **Keys** are non-extractable `CryptoKey`s in the worker's memory.
  Nothing key-related is written to disk. If the OS kills the app, the
  wallet is locked.
- **Biometric unlock** keeps the vault password in the Keychain or
  Keystore. Only the OS releases it, after a biometric check
  (`.biometryCurrentSet` on iOS, a Keystore key behind a `BiometricPrompt`
  `CryptoObject` on Android). Unlock then runs exactly as it does with the
  password.
- **No remote code.** There is no over-the-air update plugin and no
  `server.url` in `capacitor.config.ts`, so code reaches users only
  through signed builds (`capacitor.config.mobile.test.ts`).
- **Privacy.** The app is hidden in the app switcher, and screenshots are
  blocked on Android.

## Location

```text
 @gleam/app     dApp browser
     └───────┬───────┘
             ▼
           worker       runs @gleam/runtime
             │
             ▼
        @gleam/core
```
