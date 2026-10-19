# Gleam

A Chrome MV3 browser-extension wallet for Arweave and AO. It has a
password-protected key vault, AR and AO token balances, send/receive, a
merged activity feed, tagged Arweave uploads, and an ArConnect-compatible
`window.arweaveWallet` provider. Every dApp signing request opens its own
approval window with a decoded preview.

permawebOS, a working wallet we reverse-engineered, is at
`~/Downloads/permawebOS/` (minified). Check it when a protocol detail is
unclear. Visual design rules are in `DESIGN.md`. The community scans
design is in `SCANS.md`. Remaining work is in `todo.md`, and the Gleam
Points launch steps are in `LAUNCH.md`.

## Stack

TypeScript, pnpm workspaces, WXT (MV3), React 19, Tailwind 4, shadcn/Radix
primitives, `@tanstack/react-query`, `@webext-core/messaging`, Vitest
(jsdom), `arweave-js`, `@dha-team/arbundles` (web build).

## Layout

- `packages/core`: pure domain logic. `signer/` (vault envelope, key
  import and signing, keyring; reached only through `@gleam/core/signer`
  and allowed no npm imports but `hash-wasm`), `vault/` and `keys/`
  (signing pipelines, JWK), `arweave/` (AR balance, transfer, GraphQL, upload), `ao/` (AO
  balance, transfer, result), `activity/`, `pricing/`, `policy/`, and
  `models/`. `ports/` holds the interfaces for storage, runtime and
  windows.
- `packages/messaging`: the typed `ProtocolMap` wire contracts between
  popup, background, content script and page.
- `packages/ui`: design tokens, primitives and shared components.
- `apps/extension/entrypoints/`: `background`, `content`, `provider`
  (injected into the page), `approval`, `passkey`, `sidepanel`, and
  `popup/<screen>/`.
- `apps/points-api`: the Gleam Points server (Hono, Postgres, runs with
  `tsx` on Railway). Spec in `POINTS.md`.
- `scripts/scan/`: the `pnpm scan start|finish` CLI that scan agents run
  (spec in `SCANS.md`).
- `apps/extension/src/handlers/`: background handlers such as
  `wallet-lifecycle`, `reads`, `transfer`, `upload`, `approval` and
  `key-session`. `src/adapters/` implements the core ports.

## Patterns

- **Hexagonal.** `core` never imports `chrome.*`, WXT or an adapter. Pass
  network access in (`fetchImpl`, URLs) and storage through `StoragePort`.
  The background entrypoint connects adapters to handlers.
- **UI never imports background code.** Every cross-context call goes
  through `packages/messaging`. `src/dispatch/methods.ts` is the one table
  of each method's caller tier, whether it can open an approval, and the
  zod schema its page-supplied params are parsed with; the background
  dispatcher enforces it before any handler runs.
- **Signing keys** are decrypted on unlock and held in
  `chrome.storage.session` through `handlers/key-session.ts`, keyed by
  wallet id. Handlers get the key from there. Never re-derive it from a
  password.
- **Passkey unlock** wraps the vault password under the passkey's
  WebAuthn PRF output (`core/vault/passkey.ts`, `handlers/passkey.ts`),
  so it unlocks exactly like the password. The RP id is the extension
  id. The action popup closes when the browser's passkey prompt takes
  focus, so from the popup every ceremony runs in the `passkey.html`
  window (`src/passkey/open-window.ts`); the side panel and approval
  window run it inline.
- **AO sends** are ANS-104 items built and signed with plain WebCrypto in
  `core/ao/transfer.ts`, then POSTed to `mu.ao-testnet.xyz`. Don't use
  `@permaweb/aoconnect`: its browser build's signature check breaks raw-JWK
  signing in Chrome. Outcomes are read from `cu.ao-testnet.xyz/result/…`
  (`core/ao/result.ts`).
- **Amounts** are atomic-integer strings (Winston, or the token's smallest
  unit). Never floats.
- **Activity** merges the local optimistic log with gateway GraphQL. A
  background alarm settles pending entries every minute.
- **Tests** sit next to the file they test (`foo.ts` → `foo.*.test.ts`).
  Mock the network with a stubbed `fetch`. Mock a whole module only at a
  package boundary.
- **Announcements** for the main-screen notice card live in
  `apps/site/announcements.json`: `[{ id, level: "info" | "critical",
  text, url? }]`. They go live when the site deploys, and popups pick
  them up within an hour. Dismissals are stored by `id`, so a changed
  notice needs a new `id`. A `url` must be https on the Gleam site or
  `x.com` (`handlers/announcements.ts`), or the entry is dropped.
- **Comments** explain the non-obvious *why*. Don't narrate the change
  that produced the code.

## Build and check

```bash
pnpm install
pnpm dev                                   # WXT dev build with live reload
pnpm wxt:build                             # production build → apps/extension/.output/chrome-mv3
pnpm vitest run [path-fragment]            # tests
pnpm tsc -p packages/core --noEmit         # also: packages/messaging, packages/ui, apps/extension, apps/points-api, scripts/scan
pnpm eslint --max-warnings=0 <files>
```

The pre-commit hook (lefthook) runs eslint on staged files and tsc on all
six projects. A change is done when tests, tsc, eslint and `pnpm wxt:build`
pass. If a change touches signing, network or extension wiring, it also
needs a manual check in Chrome (load `.output/chrome-mv3` unpacked).

## Workflow

Take items from `todo.md` and group related ones together. Make one
Conventional Commit per item (`fix(ao): …`, `feat(activity): …`) on a
shared branch for the group, open one PR for the whole branch, and merge
it once CI is green. Then remove the completed items from `todo.md`.
`master` accepts only signed commits through a PR with passing CI, and
admins get no bypass. This repo signs commits with an SSH key (`git
config --local commit.gpgsign true`), so the key has to be loaded in
`ssh-agent`. `todo.md` is not tracked in git. Add anything new you find to
`todo.md`'s **Unsorted** section instead of fixing it on the side.

## Releasing

When Will asks to cut or ship a release, run `pnpm release:all <major|minor|patch> --key <path-to-cws-private-key>`
(or set `GLEAM_CWS_KEY`). It walks version bump → PR → tag → CI build →
pack/sign, pausing at each step a human has to clear (merging the PR,
confirming the GitHub Release exists). It refuses to tag without an audit
at `security/audits/v<version>.md` with no open critical/high findings —
point that out if the pause before tagging hits it. The Chrome Web Store
upload at the end stays manual; no store credentials or signing key ever
reach CI.
