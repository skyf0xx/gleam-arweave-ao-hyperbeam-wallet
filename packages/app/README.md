# @gleam/app

Every screen of the wallet, the router that connects them, and the
approval UI. A shell (today the Chrome extension) wraps `<App>` or
`<ApprovalRoot>` in a `PlatformProvider` and supplies an `AppPlatform`;
it holds no wallet logic and no screens of its own.

Nothing here imports `chrome.*`, WXT, `@webext-core/*`, Capacitor, or a
shell's code; ESLint fails the build if it does. A screen that needs the
host asks `usePlatform()` and branches on `capabilities`, never on which
shell mounted it. Data comes from the background through the
`RuntimePort` on `AppPlatform`, over the `@gleam/messaging` contracts.

## Components

- [`App.tsx`](#apptsx) — the router for the popup and side panel
- [`app-platform/`](#app-platform) — what a shell must supply
- [`screens/`](#screens) — one folder per screen
- [`approval/`](#approval) — the approval window's UI
- [`app.css`](#appcss) — the stylesheet entry shells import
- [shared modules](#shared-modules)

### App.tsx

`<App layout="popup" | "sidepanel">` reads `getState` and picks onboarding,
unlock or the main screen, with a nested view switch under the main
screen. It owns one `QueryClient` per document and applies the stored
theme.

### app-platform/

- **`types.ts`** — `AppPlatform`: the runtime client, build info,
  `capabilities`, host permissions, ephemeral state, the passkey window,
  the active-site feed, the downloads permission and `hardwareWallets`
  (connect pages and device signing panels).
- **`context.tsx`** — `PlatformProvider` and `usePlatform`.
- **`testing.tsx`** — `fakeAppPlatform` and `renderWithPlatform` for tests.

### screens/

`activity`, `collectibles`, `connected-apps`, `contacts`,
`display-currency`, `lock-settings`, `main-screen`, `manage-tokens`,
`network-peers`, `onboarding`, `points`, `receive`, `send`,
`settings-home`, `site-wallet`, `unlock`, `upload`, `wallet-detail` and
`wallet-switcher`. Each has an `index.tsx` that exports its views and a
`src/` with the views, hooks and tests.

### approval/

`ApprovalRoot` loads one pending request and renders the connection,
add-token, signing or scan-attestation screen, with onboarding and unlock
in place when the wallet needs them. A hardware wallet's request goes on
to `AwaitingDeviceView`, which drives the `DeviceSignPanel` the shell
supplies through `AppPlatform.hardwareWallets.signPanels`.

### app.css

Imports `@gleam/ui`'s theme and adds this package as a Tailwind source.
Tailwind 4 scans only the importing app and the paths named in `@source`,
so a shell must import this file, not `theme.css`, or the screens' utility
classes are never generated.

### Shared modules

`address-identity.tsx` and `account-avatar.ts` (avatars seeded from the
security phrase), `display-settings.ts`, `points-share.ts`,
`security-phrase-icon.ts`, `passkey/webauthn.ts` (the WebAuthn calls) and
`keyfile/download.ts`.

## Tests

Tests sit next to the file they test and run in jsdom. Screens render
under `renderWithPlatform`; the background is a stubbed `RuntimePort`.
