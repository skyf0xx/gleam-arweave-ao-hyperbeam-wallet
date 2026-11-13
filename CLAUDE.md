# Gleam

A Chrome MV3 browser-extension wallet for Arweave and AO. It has a
password-protected key vault, AR and AO token balances, send/receive, a
merged activity feed, and an ArConnect-compatible
`window.arweaveWallet` provider. Every dApp signing request opens its own
approval window with a decoded preview.

If you are running a community security scan, `security/scan/SKILL.md` is
your whole task and the only instructions you need. The rest of this file
is for contributors.

Visual design rules are in `DESIGN.md`. The community scans design is in
`SCANS.md`.

## Stack

TypeScript, pnpm workspaces, WXT (MV3), React 19, Tailwind 4, shadcn/Radix
primitives, `@tanstack/react-query`, `@webext-core/messaging`, Vitest
(jsdom), `arweave-js`, `zod`. `@dha-team/arbundles` is a dev dependency:
tests check Gleam's ANS-104 bytes against it.

## Layout

- `packages/core`: pure domain logic. `signer/` (vault envelope, key
  import and signing, keyring; reached only through `@gleam/core/signer`
  and allowed no npm imports but `hash-wasm`), `vault/` and `keys/`
  (signing pipelines, JWK), `arweave/` (AR balance, transfer, GraphQL,
  bundler), `ao/` (AO balance, transfer, result, peers), `hardware/`
  (Ledger APDUs), `backup/` (the vault backup's file format, merge and
  Drive client), `points/`, `scan/`, `recipients/`, `activity/`,
  `pricing/`, `policy/` and `models/`. `ports/` holds the interfaces for
  storage, session keys, the approval presenter, timer, badge, downloads,
  device key and the runtime client.
- `packages/messaging`: the typed `ProtocolMap` wire contracts between
  popup, background, content script and page.
- `packages/runtime`: `createRuntime(platform)` and its dispatcher
  (`create-runtime.ts`), the method table (`dispatch/methods.ts`),
  every handler (`handlers/`) such as `wallet-lifecycle`, `reads`,
  `transfer`, `approval`, `provider` (the page methods) and
  `key-session`, and the alarm-driven jobs beside them (`peers.ts`,
  `points-invite.ts`, `points-attest.ts`). It reaches a platform only
  through `Platform` (`platform.ts`).
- `packages/ui`: design tokens, primitives and shared components.
- `packages/app`: every screen (`src/screens/<screen>/`), the router
  (`src/App.tsx`) and the approval UI (`src/approval/`). It reaches a host
  only through `AppPlatform` (`src/app-platform/`), so any shell can mount
  it.
- `packages/provider`: the page-world `window.arweaveWallet` script
  (`GleamProvider`, `window.gleam`, the other-wallet router and the
  `window.permawebConnect` shim). It reaches the wallet only through
  `ProviderTransport` (`src/transport.ts`); `createWindowMessageTransport`
  is the extension's `postMessage` half of the content-script relay.
- `packages/keystone`: Keystone over QR for both shells: UR assembly,
  account decode, sign request, the camera `QrScanner`, `AnimatedQr`,
  `KeystoneConnectView` and `createKeystonePanel`. A shell hands the view
  and panel to `@gleam/app` through `AppPlatform.hardwareWallets`, because
  `app` may not import `@keystonehq` or `@ngraveio`.
- `apps/extension`: the WXT shell. `entrypoints/` holds `background`,
  `content`, `provider` (builds `provider.js` from `@gleam/provider`),
  `keyring`, `approval`, `passkey`, `sidepanel`, `popup` and `connect`;
  the popup, side panel and approval entrypoints only mount `@gleam/app`.
  `src/adapters/` implements the core and runtime ports and `AppPlatform`
  (`adapters/app-platform.ts`) on `chrome.*`; `src/hardware/` holds the
  Ledger transport and panel and opens the connect page in a tab.
- `apps/mobile`: the Capacitor shell for iOS and Android (Vite + React,
  `ios/` and `android/` native projects). `src/main.tsx` mounts
  `@gleam/app` with `layout="phone"` and the shell's `AppPlatform`
  (`src/app-platform.ts`). It loads only its bundled `dist/`: no
  `server.url` and no live-update plugin (`capacitor.config.mobile.test.ts`).
- `apps/points-api`: the Gleam Points server (Hono, Postgres, runs with
  `tsx` on Railway).
- `scripts/scan/`: the `pnpm scan start|finish` CLI that scan agents run
  (spec in `SCANS.md`).

## Patterns

- **Hexagonal.** `core` never imports `chrome.*`, WXT, Capacitor, another
  Gleam package or an adapter. Pass network access in (`fetchImpl`, URLs)
  and storage through `StoragePort`.
  `runtime` is held to the same rule (no `chrome`/`browser`, `wxt/*`,
  `@webext-core/*`, `@capacitor/*` or shell imports; ESLint enforces it).
  The background entrypoint builds a `Platform` from the adapters and
  hands it to `createRuntime`. `app` follows the same fence: screens
  reach the host through `AppPlatform` (runtime client, permissions,
  downloads, hardware wallets, passkey window), and the shell mounts
  `<PlatformProvider platform={…}>` around `<App>`. `provider` has the
  same fence and also may not import `@gleam/core`, `runtime`, `app`,
  `ui`, or anything from `@gleam/messaging` but `page-protocol.ts`: it
  runs in the page, and a transport never puts an origin in a request.
  dependency-cruiser checks these fences on resolved files
  (`.dependency-cruiser.cjs`, `pnpm deps:check`), so a relative path or a
  re-export counts the same as a package import.
- **UI never imports background code.** Every cross-context call goes
  through `packages/messaging`. `packages/runtime/src/dispatch/methods.ts` is the one table
  of each method's caller tier, whether it can open an approval, and the
  zod schema its page-supplied params are parsed with; the background
  dispatcher enforces all three before any handler runs. Only a method
  marked `approval: true` gets `requestApproval` in its handler's call;
  the page handlers (`handlers/provider.ts`) never receive the approval
  handler itself.
- **Signing** decodes the exact bytes it is about to sign and checks them
  against the approved request (`handlers/prepared-check.ts`) before any
  signer runs, for keyfile and hardware wallets alike, and for the
  wallet's own sends as for a dApp's. There is no one-step
  build-and-sign function. A preview headline names only what its reader
  consumed; every other tag is counted beside it
  (`core/ao/other-tags.ts`), never only under Details. In
  `app/src/approval/` and `app/src/transfer-review/`, a string from a
  site, a token process, a tag or a device renders through
  `UntrustedText` (`gleam/untrusted-text`).
- **Storage writes.** A value computed from the stored one is written
  with `updateStored(storage, key, next)` (`runtime/src/storage-update.ts`),
  which runs one update per key at a time; `next` never awaits. That
  holds when the read happened in a helper:
  `gleam/no-storage-read-modify-write` checks a whole file, and a whole-value write takes a disable with its
  reason. A key more than one module uses is declared once, in
  `runtime/src/storage-keys.ts`. Every value read from storage passes a
  type guard (`isValidWallet`, `isValidGrant`, …) before use.
- **Security surface.** `security/surface.txt` lists, by tier, the files
  that key, signing and page-boundary code depends on.
  `security/surface-closure.security.test.ts` fails on a file the entry
  points import that is neither listed nor exempted, with a reason, in
  `security/surface-exempt.txt`. The keyring page loads only key code,
  which `pnpm check:bundles` checks in the build.
- **Signing keys** are decrypted on unlock and imported, by wallet id,
  as non-extractable WebCrypto keys into the keyring offscreen document
  (`entrypoints/keyring/`), which holds them in memory only.
  `chrome.storage.session` holds no key material: per unlocked wallet
  only the address and public key, beside the session record and the
  pending approvals. Handlers get a signer through `handlers/key-session.ts`
  (`getSigner`). Never write key material to `chrome.storage` or
  IndexedDB, and never re-derive it from a password.
- **Vault backup** keeps one encrypted file in the user's cloud account
  through `CloudFilePort` (`handlers/backup.ts`, `backup-sync.ts`). Its
  random key is stored wrapped under the vault password
  (`signer/backup-key.ts`) and held unwrapped only by the keyring, from
  unlock to lock. The file holds one vault per install; a write replaces
  only this install's, and a restore merges them all. A storage key is
  backed up only when `core/backup/file.ts` lists it with a guard.
  The extension and Android use a Drive app folder
  (`core/backup/google-drive.ts`), and iOS a CloudKit record. On mobile
  the plugins (`plugins/cloud-backup`) run on the UI thread, which serves
  the port to the runtime worker (`adapters/cloud-file-channel.ts`).
- **Passkey unlock** wraps the vault password under the passkey's
  WebAuthn PRF output (`core/vault/passkey.ts`, `handlers/passkey.ts`),
  so it unlocks exactly like the password. The RP id is the extension
  id. Unlock runs the prompt in place on every surface, the action popup
  included, and starts it on its own when the page has focus. Setup runs
  in the `passkey.html` window (`src/passkey/open-window.ts`).
- **AO sends** are ANS-104 items built and signed with plain WebCrypto in
  `core/ao/transfer.ts`, then POSTed to `mu.ao-testnet.xyz`. Don't use
  `@permaweb/aoconnect`: its browser build's signature check breaks raw-JWK
  signing in Chrome (dependency-cruiser refuses the import). Outcomes
  are read from `cu.ao-testnet.xyz/result/…`
  (`core/ao/result.ts`).
- **Translations** live in `packages/app/src/i18n/messages/<screen>.ts`,
  one `defineMessages({ en, es, … })` per screen folder for the eleven
  languages in `i18n/define.ts`, keyed
  `namespace.name` and read with `useT()` (`t()` outside React). A key
  missing from any language fails `tsc`, and `catalog.i18n.test.ts` checks
  placeholders match. Without a stored choice the language follows the
  device and falls back to English. Never translate decoded transaction
  data, addresses or tag values.
- **User-facing errors.** `core` and `runtime` throw English. An error a
  person can reach is declared in `core/models/user-errors.ts` and thrown
  with `userErrorMessage`. Only `message` crosses every transport, so the
  app matches the text back to its code and translates it at display with
  `errorText` (`app/src/i18n/errors.ts`). dApps get the English. In
  `runtime`, a literal `throw new Error("…")` is a lint error: wrap
  English-by-design text (dApp-facing, or an invariant no person sees) in
  `dappError`. A new one-off string outside the table stays English.
  Compare raw `.message`,
  never `errorText`'s output.
- **Amounts** are atomic-integer strings (Winston, or the token's smallest
  unit). Never floats.
- **URLs and bytes.** Trailing slashes come off with
  `trimTrailingSlashes`, never a regex (CodeQL flags the backtracking).
  Bytes that may come from another realm are tested with
  `ArrayBuffer.isView`, not `instanceof`.
- **Activity** merges the local optimistic log with gateway GraphQL. A
  background alarm settles pending entries every minute.
- **Tests** sit next to the file they test (`foo.ts` → `foo.*.test.ts`).
  Mock the network with a stubbed `fetch`. Mock a whole module only at a
  package boundary.
- **Announcements** for the main-screen notice card live in
  `apps/site/announcements.json`: `[{ id, level: "info" | "critical",
  title?, text, url?, platforms?, below? }]`. They go live when the site
  deploys, and popups pick them up within an hour. `platforms` (any of
  `extension`, `android`, `ios`) and `below` (`x.y.z`) limit an entry to
  those shells on older versions, which is how an APK update notice is
  sent. Dismissals are stored by `id`, so a changed
  notice needs a new `id`. A `url` must be https on the Gleam site or
  `x.com` (`handlers/announcements.ts`), or the entry is dropped.
- **Comments** explain the non-obvious *why*. Don't narrate the change
  that produced the code.
- **UX and copy.** Never change UX or user-facing copy (the app, the
  site, store listings) unless the developer asked for that change or
  confirmed it. When a code change makes either one wrong, propose the
  fix and wait.

## Build and check

```bash
pnpm install
pnpm dev                                   # WXT dev build with live reload
pnpm wxt:build                             # production build → apps/extension/.output/chrome-mv3
pnpm mobile:build                          # app web bundle → apps/mobile/dist (mobile:ios / mobile:android sync and open the native project)
pnpm check:bundles                         # after wxt:build: what the keyring page and provider.js contain, and their size
pnpm test:smoke                            # after wxt:build: loads the built extension in Chromium
pnpm vitest run [path-fragment]            # tests
pnpm tsc -p packages/core --noEmit         # also: packages/messaging, packages/ui, packages/runtime, packages/app, packages/provider, packages/keystone, apps/extension, apps/mobile, apps/points-api, scripts/scan, tsconfig.scripts.json
pnpm eslint --max-warnings=0 <files>
pnpm deps:check                            # the import fences, on resolved files
```

The pre-commit hook (lefthook) runs eslint and gitleaks on staged files,
`pnpm deps:check`, and tsc on all twelve projects; install gitleaks first
(`brew install gitleaks`). A change is done when tests, tsc, eslint,
`pnpm deps:check`, `pnpm wxt:build`, `pnpm check:bundles`,
`pnpm mobile:build` and `pnpm test:smoke` pass. CI also runs zizmor,
osv-scanner, web-ext lint and Semgrep, and a weekly mutation run
(`stryker.config.mjs`) over `core/signer`, `core/vault` and
`runtime/dispatch`. If a change touches signing, network or
extension wiring, it also needs a manual check in Chrome (load
`.output/chrome-mv3` unpacked).

## Workflow

Make one Conventional Commit per change (`fix(ao): …`,
`feat(activity): …`), group related commits on one branch, open one PR
for the branch, and merge it with a merge commit once CI is green
(`gh pr merge <n> --merge`; the ruleset refuses squash and rebase
merges). `master` accepts only signed commits through a PR with passing
CI, and admins get no bypass. The Security surface check fails a PR
that touches a `security/surface.txt` path until its description ticks
the surface box (the PR template has it); the next release then needs a
fresh audit.
This repo signs commits with an SSH key (`git config --local
commit.gpgsign true`), so the key has to be loaded in `ssh-agent`.

## Releasing

One signed tag `v<version>` releases the extension and both apps. The
steps are in the `release` skill (`.claude/skills/release/SKILL.md`).
