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

## Where it sits

```text
screens ─────────────┐
                     ├→ worker (@gleam/runtime) → @gleam/core
dApp browser page ───┘
```
