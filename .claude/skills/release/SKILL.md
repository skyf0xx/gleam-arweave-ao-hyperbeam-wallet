---
name: release
description: Use when asked to cut, ship, tag or publish a Gleam release, or to build the signed extension, iOS or Android artifacts for a version. Covers the peer-list refresh, the release audit, the version bump PR, the signed tag, the GitHub Release and the three signed builds. Triggers on "cut a release", "ship v1.x", "release a patch", "build the release apps".
---

# Release Gleam

One signed tag `v<version>` releases the extension and both apps.

Signing keys and store credentials live in a local KeePassXC database, so
steps 2 and 3 need the maintainer at the terminal. CI holds no signing
key or store credential.

## Steps

1. **Peers and audit.** Run `pnpm peers:refresh` and update
   `COMMUNITY_HYPERBEAM_PEER_URLS` (`core/models/network.ts`) from what it
   prints. Installs refresh the list daily on their own; the shipped list
   is what they start from. Then write `security/audits/v<version>.md`
   (`security/audits/TEMPLATE.md`). The gate refuses to tag while any
   security-surface file changed after the audited commit or a
   critical/high finding is open.
2. **Bump, tag and extension.** `pnpm release:all <major|minor|patch>`
   sets one version in the extension, the mobile package, iOS and Android
   (`scripts/app-versions.mjs`), adds 1 to both build numbers, and opens
   the bump PR. After the merge it tags, and `release.yml` publishes the
   zip and `release-manifest.json` (with `mobileBundleSha256`) as a GitHub
   Release. Run `scripts/verify-release.sh v<version>` in its own terminal
   session first: it rebuilds the tag and runs npm code. `pack-release.sh`
   then checks the Release's zip against its manifest, its attestation
   and the receipt the rebuild left, and signs that zip as the `.crx`,
   running no npm code. Without a matching receipt it refuses.
3. **Apps**, from a clean checkout of the tag:
   `apps/mobile/scripts/release-app.sh v<version> ios|ios-ipa|android|android-bundle|android-apk`.
   It checks the tag against `origin/master`, rebuilds the web bundle and
   compares it with the manifest before unlocking any credential
   (`apps/mobile/fastlane/README.md`).
4. **Stores stay manual:** the Chrome Web Store upload, App Store review,
   and promoting the Android build.

## The three signed builds

Once the GitHub Release exists and `scripts/verify-release.sh v<version>`
has passed in another terminal session, the three signed builds come from
a clean checkout of the tag:

```bash
scripts/pack-release.sh v<version> --kdbx <db> && \
apps/mobile/scripts/release-app.sh v<version> ios --kdbx <db> && \
apps/mobile/scripts/release-app.sh v<version> android-apk --kdbx <db>
```
