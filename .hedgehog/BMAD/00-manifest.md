# Planning intake manifest

Source: BMAD-METHOD (`bmad-code-org/BMAD-METHOD`, tag `v6.11.0`, MIT-licensed),
vendored under `vendor-skills/BMAD/`. Mode: **compressed** (authored core).
Date: 2026-09-14.

## Why compressed

The user provided a separate, already-researched sibling repo
(`/Users/williamgikandi/Documents/code/ao-wallet/`) containing a product
brief (`GLEAM.md`), a full technical/vault spec (`CLAUDE.md`), a stack and
build-order architecture doc (`ARCHITECTURE.md`), a screen inventory
(`screens/TODO.md`), and 16 built HTML screen mockups. The user explicitly
chose to treat this material as the settled brief rather than re-running
live BMAD elicitation in this session (confirmed via direct question: "Use
existing docs as brief").

This project (`gleam-arweave-ao-hyperbeam-wallet`) is a **new build from
scratch** — the repo held nothing but `.git` at intake time. The sibling
repo is inspiration/reference material, not code being ported or a
codebase being adopted (confirmed with the user: not `adopted`, is
`authored`).

## Files written

- `04-prd.md` — §3 Glossary and §4 Features only, mined from
  `GLEAM.md`, `CLAUDE.md`, and `ARCHITECTURE.md`.
- `05-ux-spec/EXPERIENCE.md` — flows and behavior, mined from
  `CLAUDE.md`'s Phase 1 feature list, `screens/TODO.md`'s per-screen specs,
  and `ARCHITECTURE.md`'s build order. No `DESIGN.md` — visual identity
  (brand palette, typography) exists in the sibling repo's `brand/` folder
  but is treated as reference the ui layer consults directly, not
  re-derived into a BMAD design doc here.

## Files not written

`01-brainstorming.md`, `02-brief.md`, `03-prfaq.md`, `06-research.md` — not
produced by compressed intake; the sibling repo's docs substitute for their
purpose (idea validation, market comparison) via its own
`competitive-teardown.md` and `permawebos-teardown.md`, which are not
re-derived here.

## What was inferred vs. asked directly

- **Scope = Phase 1 only** (password-vault wallet, AR/AO send-receive,
  activity feed, upload, injected provider + approval flow) — inferred
  directly from `CLAUDE.md`'s explicit "Phase 1 (build first)" /
  "Phase 2 (feature-parity additions)" split and `ARCHITECTURE.md §6`'s
  build order, which stops the demoable path at Phase 1b (dApp surface).
  Phase 2 items (Ethereum keys, Ledger, ArNS, uniques, auto-sign/gatekeeper,
  import/export settings) are named as later scope, not built now.
- **Repo/package layout** — inferred directly from `ARCHITECTURE.md §2`
  (`packages/core`, `packages/messaging`, `packages/ui`, `apps/extension`),
  confirmed with the user directly ("Follow ao-wallet's exact layout").
- **Stack** (WXT, React 19, Tailwind 4, Radix/shadcn, `@webext-core/messaging`,
  `arweave-js`, `@dha-team/arbundles`) — inferred directly from
  `ARCHITECTURE.md §1`, version-checked there as of Sept 2026.
