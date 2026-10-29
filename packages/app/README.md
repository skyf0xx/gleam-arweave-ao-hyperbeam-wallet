# @gleam/app

This package is everything the user sees: every screen, including the
approval screens that dApp requests open, and the router that moves
between them. The Chrome extension and the mobile app both display these
same screens.

The screens never know which app they are running in. The host app
injects an `AppPlatform` through React context, and the screens reach
the background and host features such as permissions, downloads and
hardware wallets only through it, much as a component receives an API
client from a provider.

## Structure

- **`App.tsx`**: the router, which decides whether to show onboarding,
  unlock or the main screen, and arranges it for the popup, side panel or
  phone.
- **`app-platform/`**: the `AppPlatform` an app provides, and the
  `usePlatform()` hook that screens use to reach it.
- **`screens/`**: one folder per screen, such as `send`, `receive`,
  `activity`, `settings-home` and `onboarding`.
- **`approval/`**: the screens a dApp's request opens, covering connect,
  sign, add token and scan attestation.
- **`app.css`**: the stylesheet an app imports to get the theme together
  with the screens' styles.
- Shared helpers for avatars, display settings, passkeys, biometrics and
  keyfile downloads.

## Location

```text
 Extension          Mobile
     └────────┬───────┘
              ▼
          @gleam/app    all screens
              │ AppPlatform
              ▼
        @gleam/runtime  the background
```
