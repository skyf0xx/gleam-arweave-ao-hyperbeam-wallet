# Release lanes

fastlane builds, signs and uploads the app from a release tag, on your own
machine. CI builds unsigned artifacts only; signing keys and store
credentials stay in the KeePassXC database and never reach CI.

Run the lanes through `scripts/release-app.sh`. It checks the tag (on
`origin/master`, signed by a key in `origin/master`'s `.github/allowed_signers`), builds
and verifies the web bundle with no credentials in the environment, then
unlocks the database, exports the credentials into a private temp dir
(deleted on exit) and runs the lane.

```bash
apps/mobile/scripts/release-app.sh v1.31.0 ios            --kdbx ~/.secrets/gleam-cws/gleam-cws.kdbx
apps/mobile/scripts/release-app.sh v1.31.0 ios-ipa        --kdbx ~/.secrets/gleam-cws/gleam-cws.kdbx
apps/mobile/scripts/release-app.sh v1.31.0 android        --kdbx ~/.secrets/gleam-cws/gleam-cws.kdbx
apps/mobile/scripts/release-app.sh v1.31.0 android-bundle --kdbx ~/.secrets/gleam-cws/gleam-cws.kdbx
apps/mobile/scripts/release-app.sh v1.31.0 android-apk    --kdbx ~/.secrets/gleam-cws/gleam-cws.kdbx
```

`ios` signs and uploads to TestFlight, `ios-ipa` stops at the signed IPA,
`android` uploads to the Play internal track, `android-bundle` stops at
the signed AAB, and `android-apk` signs an APK with the upload key and
attaches it to the tag's GitHub Release as `gleam.apk`, with its SHA-256 in
the release notes. Sideloaded installs can't later update from Play, which
signs with its own key.

`GLEAM_CWS_KDBX` replaces `--kdbx`; `GLEAM_CWS_KDBX_YUBIKEY=<slot[:serial]>`
adds a YubiKey.

## Prerequisites

- A clean checkout at the signed tag.
- `pnpm install`, `keepassxc-cli` (`brew install --cask keepassxc`) and
  `gh` or network access to the GitHub Release.
- A modern Ruby with Bundler. macOS's `/usr/bin/ruby` is too old:
  `brew install ruby`, then put `$(brew --prefix ruby)/bin` first on
  `PATH`. `bundle install` runs from `apps/mobile`. The script checks for
  Ruby 3 or newer before it unlocks anything.
- iOS: macOS with Xcode.
- Android: JDK 21 (checked by the script; `JAVA_HOME` is used when set)
  and the Android SDK.

## Lanes

| Lane | What it does |
| --- | --- |
| `ios prepare` / `android prepare` | `pnpm mobile:build`, `cap sync`, then the bundle check. No credentials. |
| `ios signed_ipa` | Bundle check, then a signed `Gleam.ipa` with cloud-managed signing; prints its path. |
| `ios beta` | `ios signed_ipa`, then upload to TestFlight without waiting for processing. |
| `android signed_bundle` | Bundle check, then a signed `app-release.aab`; prints its path. |
| `android internal` | `android signed_bundle`, then upload to the Play internal track. |

## Bundle check

Before anything is signed, `scripts/verify-bundle.mjs` compares the hash of
`apps/mobile/dist` with `mobileBundleSha256` in the tag's
`release-manifest.json`, and the synced native copy (`ios/App/App/public`,
`android/app/src/main/assets/public`) with `dist`. A mismatch or a missing
field aborts the lane.

The hash is defined in `scripts/bundle-hash.mjs`, which CI uses too:
sha256 over the sorted lines `<relative-path>\0<sha256-of-file>\n`
for every file in the directory.

`release-app.sh ... --allow-unverified-bundle` skips the manifest comparison
(not the dist-versus-native one), asks you to type `yes` and prints a
warning. Use it only for a tag whose manifest has no `mobileBundleSha256`.
`release-app.sh` ignores `GLEAM_ALLOW_UNVERIFIED_BUNDLE` from the
environment; only the flag sets it.

`release-app.sh` also refuses to run when `android/local.properties` has
anything but `sdk.dir`, or when `~/.gradle/init.d` has scripts, because
both inject code into the Gradle build that holds the keystore passwords.

## KeePassXC entries

The mobile entries live in the same database as the Chrome Web Store key.
Names and attachment names can be overridden with the variables in the
header of `release-app.sh`.

| Entry | Attachment | Other fields |
| --- | --- | --- |
| `App Store Connect API` | the single `AuthKey_*.p8` it holds (`GLEAM_ASC_KEY_ATTACHMENT` names it explicitly) | attributes `KEY_ID`, `ISSUER_ID` (or `ASC_KEY_ID`, `ASC_ISSUER_ID` in the environment) |
| `Play service account` | `play-service-account.json` | none |
| `gleam-upload-keystore` | `upload-keystore.jks` | password = keystore password; attributes `KeyAlias`, `KeyPassword` |

The App Store Connect key needs the Admin role: cloud-managed signing
creates the distribution certificate and profile.

## Apple team id

The team id is set in `fastlane/Appfile` (default `2GYJRK444L`). If the
account changes, set `GLEAM_APPLE_TEAM_ID` instead of editing files. The
Xcode project's `DEVELOPMENT_TEAM` is overridden at build time.

## First Play upload

Google does not let the API make an app's first upload. Run
`android-bundle`, upload the printed AAB by hand in Play Console (Test and
release, Internal testing), and use `android` for every upload after that.
