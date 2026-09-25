# Contributing

## Setup

```bash
pnpm install
pnpm dev            # WXT dev build with live reload
```

Node 22+ and pnpm (see `packageManager` in [package.json](package.json)) are
required. The `prepare` script installs a [lefthook](lefthook.yml)
pre-commit hook that runs eslint and tsc on staged files — don't skip it.

## Before opening a PR

```bash
pnpm vitest run                            # tests
pnpm tsc -p packages/core --noEmit         # also: packages/messaging, packages/ui, apps/extension
pnpm eslint --max-warnings=0 .
pnpm wxt:build                             # production build
```

CI runs all of the above on every PR; it won't merge if any fail.

If a change touches signing, network requests, or extension wiring, also load
`apps/extension/.output/chrome-mv3` unpacked in Chrome and check it by hand —
none of the automated checks exercise the real extension runtime.

## Conventions

Read [CLAUDE.md](CLAUDE.md) first — it covers the architecture (hexagonal
core, message-passing between UI and background, key-session handling for
signing) and the patterns a change is expected to follow.

- One [Conventional Commit](https://www.conventionalcommits.org/) per logical
  change (`fix(ao): …`, `feat(activity): …`). Keep PRs to a single concern.
- `packages/core` never imports `chrome.*`, WXT, or an adapter — network and
  storage access are passed in, not reached for.
- UI code never imports background code directly; cross-context calls go
  through `packages/messaging`.
- Tests sit next to the file they test (`foo.ts` → `foo.*.test.ts`). Mock the
  network with a stubbed `fetch`, not a live gateway.
- Comments explain non-obvious *why*, not the change that produced the code.

## Security

This is a wallet handling private keys. If you find a vulnerability, please
don't open a public issue — see [SECURITY.md](SECURITY.md) for how to report
it privately.
