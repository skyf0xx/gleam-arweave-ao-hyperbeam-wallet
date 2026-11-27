# Security practices

How Gleam is built, checked and released.

What it depends on, and who
can change it.

What Gleam defends against is in
[THREAT_MODEL.md](THREAT_MODEL.md), how to report a vulnerability is in
[SECURITY.md](../SECURITY.md), and what happens when something goes wrong
is in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

## Goals

1. A private key never leaves the wallet.
2. Nothing is signed, decrypted or sent unless the user approved that
   exact request.
3. Every release is built from a signed tag on `master`, reviewed
   against the security surface, and reproducible by anyone.

## Code changes

`master` takes changes only through a pull request with passing checks with signed commits. Force pushes and branch deletion are blocked for everyone including admins. Gleam has one maintainer and code-owner review
is documented in [CODEOWNERS](../.github/CODEOWNERS). Reviews are optional until another maintainer joins.

Every PR runs:

| Check                                            | What it catches                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| ESLint, with Gleam's own rules (`eslint-rules/`) | Untrusted text rendered raw, storage read-modify-write races, dynamic imports, fence breaks            |
| `tsc` on all twelve projects                     | Type errors, a translation missing from any language                                                   |
| dependency-cruiser (`pnpm deps:check`)           | An import across a fence: `core` reaching `chrome.*`, the page script reaching the wallet, cycles      |
| Vitest, with fast-check property tests           | Behaviour, including ANS-104 bytes checked against `@dha-team/arbundles`                               |
| Security surface closure (`security/`)           | A file that key, signing or page-boundary code imports but that isn't listed in `security/surface.txt` |
| `pnpm check:bundles`                             | Built scripts match their allowlists and don't have extraneous or unexpected code                      |
| Playwright smoke test                            | The built extension loading and running in Chromium                                                    |
| web-ext lint                                     | Manifest and bundle problems                                                                           |
| CodeQL, Semgrep                                  | Static analysis of the TypeScript, the Kotlin and Swift shells, and the workflows                      |
| osv-scanner, dependency-review                   | Known vulnerabilities in locked dependencies, and in a PR's new ones                                   |
| gitleaks (also pre-commit)                       | Committed secrets                                                                                      |
| zizmor                                           | Unsafe GitHub Actions workflows                                                                        |
| Gradle wrapper validation                        | A tampered `gradle-wrapper.jar` in the Android project                                                 |

A weekly Stryker mutation run over `core/signer`, `core/vault` and
`runtime/dispatch` fails when the tests stop catching injected bugs.

## Dependencies

- The lockfile is installed frozen. pnpm refuses a version less than
  three days old (`minimumReleaseAge`) and a version published with
  weaker provenance than an earlier one (`trustPolicy: no-downgrade`).
- Dependabot proposes updates weekly and holds new releases back seven
  days. Only patch and minor updates to development dependencies merge
  on their own. Production dependencies, the bundler group and GitHub
  Actions always get a review.
- Every GitHub Action is pinned to a commit SHA. Release jobs run
  harden-runner with outbound traffic blocked except to named hosts.
- Each GitHub Release carries a CycloneDX SBOM for the extension and one
  for the app (`gleam-<shell>-<version>.cdx.json`), listing every package
  each one bundles.

## Staying current

Dependabot alerts and the Web Store's policy emails reach the
maintainer directly. The maintainer also gets security notices from:

- Node.js, through the `nodejs-sec` list;
- the GitHub repositories of Capacitor, pnpm, arweave-js, AO, HyperBEAM,
  node-forge and hash-wasm, through their published advisories.

## Third-party code

Third-party code in the shipped wallet:

| Package                                                                                              | Used for                                                                               |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `arweave`                                                                                            | Transaction building and gateway calls                                                 |
| `hash-wasm`                                                                                          | Argon2id, the vault password hash                                                      |
| `node-forge`                                                                                         | Generating an RSA key from a recovery phrase, to match other Arweave wallets           |
| `zod`                                                                                                | Parsing every input from a page, the network and storage                               |
| `react`, `react-dom`, `@tanstack/react-query`, `@tanstack/react-query-persist-client`                | The UI, its server state, and that state's cache between opens                         |
| `@radix-ui/react-slot`, `vaul`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge` | UI primitives and styling                                                              |
| `qr-code-styling`, `qrcode-generator`, `jsqr`                                                        | Drawing and reading QR codes                                                           |
| `@keystonehq/bc-ur-registry-arweave`, `@ngraveio/bc-ur`                                              | Keystone hardware wallet messages                                                      |
| `@dicebear/core`, `@dicebear/styles`, `flag-icons`                                                   | Avatars and language flags                                                             |
| `tldts`                                                                                              | Finding the site in a URL, from the Public Suffix List                                 |
| `@webext-core/messaging`, `vite-plugin-node-polyfills`                                               | Extension messaging, and Node built-ins `arweave` expects                              |
| `@capacitor/*`, `@capacitor-community/*`, `@capgo/capacitor-native-biometric`, `comlink`             | The iOS and Android shell: storage, biometrics, the privacy screen, the runtime worker |

## Releases

1. A release is one signed, annotated tag `v<version>` on `master`.
2. The release gate refuses the tag without an audit at
   `security/audits/v<version>.md`, when a security-surface file changed
   after the commit that audit reviewed, or when the audit has an open
   critical or high finding.
3. CI builds the extension zip and the app's web bundle without a
   signing key or a store credential, attests the zip's build
   provenance, and publishes the zip, the attestation bundle, a manifest
   of hashes and the SBOMs.
4. The maintainer rebuilds the tag locally (`scripts/verify-release.sh`)
   and signs a zip whose hash matches the CI build, then uploads it
   by hand. The app is signed only when its web bundle's hash matches the
   manifest. The native iOS and Android shells are not reproducible,
   because the stores re-sign them.

## Cryptography

Gleam uses WebCrypto for every key operation it can, and writes no
cipher or signature scheme of its own. The details and parameters are in
[THREAT_MODEL.md § How the key is kept](THREAT_MODEL.md#how-the-key-is-kept).

| Use                         | Algorithm                                           | Implementation                  |
| --------------------------- | --------------------------------------------------- | ------------------------------- |
| Arweave signatures          | RSA-PSS 4096, SHA-256                               | WebCrypto, non-extractable keys |
| Vault password hash         | Argon2id                                            | `hash-wasm`                     |
| Vault and backup encryption | AES-256-GCM                                         | WebCrypto                       |
| Passkey unlock              | WebAuthn PRF, HKDF-SHA-256                          | WebCrypto                       |
| Recovery phrase             | BIP-39 PBKDF2-HMAC-SHA-512, then RSA key generation | WebCrypto, `node-forge`         |
| Device identity for Points  | ECDSA P-256                                         | WebCrypto, non-extractable keys |
| dApp encrypt and decrypt    | RSA-OAEP, AES as the dApp requests                  | WebCrypto                       |

## Access

Gleam has a single maintainer who holds all accounts below. CI doesn't hold secrets: its only token is the per-run `GITHUB_TOKEN`. Signing keys and
API keys live in one KeePassXC database on the maintainer's machine and
are unlocked only at the steps that use them. Every account below signs
in with a passkey, directly or through a GitHub or Google sign-in that
uses one.

| System                             | What it controls                                            | Credential                                                               |
| ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| GitHub repository (admin)          | Code, rulesets, releases, advisories                        | Maintainer account; commits and tags signed with an SSH key              |
| gleam-triage GitHub App            | Bot comments on PRs and advisories                          | App private key in KeePassXC; one-hour tokens                            |
| Chrome Web Store                   | The published extension                                     | Publisher account; CRX signing key in KeePassXC                          |
| Apple Developer, App Store Connect | The iOS app, TestFlight, the CloudKit container for backups | Account holder; API key in KeePassXC                                     |
| Google Play Console                | The Android app                                             | Maintainer account; service account key and upload keystore in KeePassXC |
| Google Cloud                       | The OAuth clients for Drive backup                          | Project owner                                                            |
| Vercel                             | gleamwallet.app and open.gleamwallet.app                    | Maintainer account                                                       |
| Cloudflare                         | DNS for gleamwallet.app                                     | Maintainer account                                                       |
| Railway                            | The Points server and its Postgres database                 | Maintainer account                                                       |
| Umami, Web3Forms                   | Site visit counts and the feedback form                     | Maintainer account                                                       |
