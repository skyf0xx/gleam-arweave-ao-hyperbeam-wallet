---
name: release
description: Use when asked to cut, ship, tag or publish a Gleam release, or to build the signed extension, iOS or Android artifacts for a version. Covers the peer-list refresh, the release audit, the changelog entry, the version bump PR, the signed tag, the GitHub Release and the three signed builds. Triggers on "cut a release", "ship v1.x", "release a patch", "build the release apps".
---

# Release Gleam

One signed tag `v<version>` releases the extension and both apps.

Signing keys and store credentials live in a local KeePassXC database, so
steps 4 and 5 need the maintainer at the terminal. CI holds no signing
key or store credential.

## Steps

1. **Code health.** Run `pnpm health`. Remove what knip reports as
   unused, and extract any copied block jscpd finds that is a real
   third copy (CLAUDE.md § Writing code). Put each capped file you won't
   split this release in `todo.md`. These fixes land before the audit,
   so it covers them.
2. **Peers and audit.** Run `pnpm peers:refresh` and update
   `COMMUNITY_HYPERBEAM_PEER_URLS` (`core/models/network.ts`) from what it
   prints. Installs refresh the list daily on their own; the shipped list
   is what they start from. Then write `security/audits/v<version>.md`
   (`security/audits/TEMPLATE.md`). The gate refuses to tag while any
   security-surface file changed after the audited commit or a
   critical/high finding is open.
3. **Changelog.** Write the `CHANGELOG.md` entry for v<version> from the
   commits and PR titles since the last tag
   (`git log <last-tag>..HEAD --no-merges --format=%s`), and show it to
   Will before the bump PR. Add `## v<version> (<YYYY-MM-DD>)` at the top,
   with `### Added`, `### Changed`, `### Fixed`, `### Security` or
   `### Upgrade notes` only as needed. Rules:
   - Flesch-Kincaid grade 7 English, for users. Concise: a few bullets,
     each one short sentence where possible. No code names or jargon.
   - Only what matters to a user: new features, visible fixes, security
     fixes, and anything that changes how they upgrade or use the wallet.
     Leave out refactors, CI, tests, docs and small polish.
   - A fix from an advisory that isn't published yet is only "Security
     fixes.", with no detail.
   `release:all` refuses to bump without the entry (it may be
   uncommitted; it goes into the bump PR), `release.mjs` refuses to tag
   without it, a test fails the bump PR without it, and `release.yml`
   puts it at the top of the GitHub Release under "What's changed".
4. **Bump, tag and extension.** `pnpm release:all <major|minor|patch>`
   sets one version in the extension, the mobile package, iOS and Android
   (`scripts/app-versions.mjs`), adds 1 to both build numbers, and opens
   the bump PR. After the merge it tags, and `release.yml` puts the zip
   and `release-manifest.json` (with `mobileBundleSha256`) in a draft
   GitHub Release. Releases are immutable once published, so the draft
   stays open until `release-app.sh … android-apk` adds `gleam.apk` and
   publishes it. A mistake found after that ships as a new patch version.
   Run `scripts/verify-release.sh v<version>` in its own terminal session
   first: it rebuilds the tag and runs npm code. `pack-release.sh`
   then checks the Release's zip against its manifest, its attestation
   and the receipt the rebuild left, and signs that zip as the `.crx`,
   running no npm code. Without a matching receipt it refuses.
5. **Apps**, from a clean checkout of the tag:
   `apps/mobile/scripts/release-app.sh v<version> ios|ios-ipa|android|android-bundle|android-apk`.
   It checks the tag against `origin/master`, rebuilds the web bundle and
   compares it with the manifest before unlocking any credential
   (`apps/mobile/fastlane/README.md`).
   Before the first iOS build that ships vault backup, and after any
   change to the CloudKit record (`VaultBackup` in
   `plugins/cloud-backup/.../ICloudFilePlugin.swift`), the maintainer
   deploys the schema: https://icloud.developer.apple.com/dashboard →
   `iCloud.app.gleamwallet` → Schema → "Deploy Schema Changes…" to
   Production. TestFlight builds read Production and refuse an
   undeployed record type.
6. **Stores stay manual:** the Chrome Web Store upload, App Store review,
   and promoting the Android build.

## The three signed builds

Once the draft GitHub Release exists and `scripts/verify-release.sh v<version>`
has passed in another terminal session, the three signed builds come from
a clean checkout of the tag:

```bash
scripts/pack-release.sh v<version> --kdbx <db> && \
apps/mobile/scripts/release-app.sh v<version> ios --kdbx <db> && \
apps/mobile/scripts/release-app.sh v<version> android-apk --kdbx <db>
```

The last command publishes the release. Until then `verify-release.sh`
and `pack-release.sh` read the draft through `gh`, since a draft has no
public download URL.
