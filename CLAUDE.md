# Gleam

A Chrome MV3 browser-extension wallet for Arweave and AO. It has a
password-protected key vault, AR and AO token balances, send/receive, a
merged activity feed, tagged Arweave uploads, and an ArConnect-compatible
`window.arweaveWallet` provider. Every dApp signing request opens its own
approval window with a decoded preview.

permawebOS, a working wallet we reverse-engineered, is at
`~/Downloads/permawebOS/` (minified). Check it when a protocol detail is
unclear. Visual design rules are in `DESIGN.md`. Remaining work is in
`todo.md`.

## Stack

TypeScript, pnpm workspaces, WXT (MV3), React 19, Tailwind 4, shadcn/Radix
primitives, `@tanstack/react-query`, `@webext-core/messaging`, Vitest
(jsdom), `arweave-js`, `@dha-team/arbundles` (web build).

## Layout

- `packages/core`: pure domain logic. `vault/` and `keys/` (encryption,
  JWK), `arweave/` (AR balance, transfer, GraphQL, upload), `ao/` (AO
  balance, transfer, result), `activity/`, `pricing/`, `policy/`, and
  `models/`. `ports/` holds the interfaces for storage, runtime and
  windows.
- `packages/messaging`: the typed `ProtocolMap` wire contracts between
  popup, background, content script and page.
- `packages/ui`: design tokens, primitives and shared components.
- `apps/extension/entrypoints/`: `background`, `content`, `provider`
  (injected into the page), `approval`, `sidepanel`, and `popup/<screen>/`.
- `apps/extension/src/handlers/`: background handlers such as
  `wallet-lifecycle`, `reads`, `transfer`, `upload`, `approval` and
  `key-session`. `src/adapters/` implements the core ports.

## Patterns

- **Hexagonal.** `core` never imports `chrome.*`, WXT or an adapter. Pass
  network access in (`fetchImpl`, URLs) and storage through `StoragePort`.
  The background entrypoint connects adapters to handlers.
- **UI never imports background code.** Every cross-context call goes
  through `packages/messaging`. The background dispatcher enforces which
  methods a page may call and which need approval.
- **Signing keys** are decrypted on unlock and held in
  `chrome.storage.session` through `handlers/key-session.ts`, keyed by
  wallet id. Handlers get the key from there. Never re-derive it from a
  password.
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
- **Comments** explain the non-obvious *why*. Don't narrate the change
  that produced the code.

## Build and check

```bash
pnpm install
pnpm dev                                   # WXT dev build with live reload
pnpm wxt:build                             # production build → apps/extension/.output/chrome-mv3
pnpm vitest run [path-fragment]            # tests
pnpm tsc -p packages/core --noEmit         # also: packages/messaging, packages/ui, apps/extension
pnpm eslint --max-warnings=0 <files>
```

The pre-commit hook (lefthook) runs eslint on staged files and tsc on all
four projects. A change is done when tests, tsc, eslint and `pnpm wxt:build`
pass. If a change touches signing, network or extension wiring, it also
needs a manual check in Chrome (load `.output/chrome-mv3` unpacked).

## Workflow

Take the top item in `todo.md`. Make one Conventional Commit per item
(`fix(ao): …`, `feat(activity): …`). Remove the item from `todo.md` in
that same commit. Add anything new you find to `todo.md`'s **Unsorted**
section instead of fixing it on the side.
