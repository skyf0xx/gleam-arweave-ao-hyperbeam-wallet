# Changelog

What changed in each Gleam release, newest first. One release covers the
Chrome extension and the iOS and Android apps.

## v1.56.1 (2026-11-27)

### Fixed

- Activity loads even when a gateway is slow to list your AO token transfers.
- Sends that went through no longer stay marked as sending when that happens.

### Upgrade notes

- The Android app now needs Android 10 or later.

## v1.56.0 (2026-11-27)

### Added

- In the app's browser, the address bar shows the site's name in bold. Hold the bar, or tap the info button, to see the full address.
- Editing the address starts from the page you're on.

### Fixed

- Activity and saved contacts load again for wallets that got some kinds of AO messages.
- When the main Arweave gateway can't load your activity, Gleam now tries a backup gateway that works.

## v1.54.2 (2026-11-27)

### Security

- On Android, the approval screen ignores taps made through another app's window.
- Security fixes.

## v1.54.1 (2026-11-25)

### Fixed

- The notice on the main screen now shows new Points invites for any of your wallets.

### Security

- Security fixes.

## v1.54.0 (2026-11-23)

### Added

- The Android app tells you when a new version is out.
- You can hide several tokens in a row, and each one asks you to confirm in place.

### Changed

- The dark theme is softer on the eyes.

### Fixed

- Saved balances no longer look faded while new ones load.

## v1.53.3 (2026-11-23)

### Changed

- Long addresses always split over two rows.
- The market colours setting is gone.

### Fixed

- The token drawer on the home screen slides smoothly and no longer bounces back.
- The send amount stays easy to read on phones.

### Security

- Nobody can remove your passkey after the wallet locks.
- A Permaweb Name shows only when two gateways agree on it.
- A token's decimals stay unknown until a second gateway confirms them, so a gateway can't fake an amount.
- Other security fixes.

## v1.53.2 (2026-11-22)

### Changed

- In the Silica theme, token rows lie flat and the chart is cleaner.
- The weather setting sits on one line under the theme.

### Fixed

- Swiping between the home tabs is easier.

## v1.53.1 (2026-11-22)

### Fixed

- Collectible images load faster, since the wallet now caches them.
- The chart and pending sends load faster.
- AO balances load more reliably.
- The loading bar shows only when you pull to refresh.
