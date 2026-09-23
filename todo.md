# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

## Now

- [ ] **Store and show why an AO send failed.** `core/ao/result.ts`
  returns `{ status: "failed", error }`, but
  `ReadsHandler.resolvePendingAoTransfers` (`apps/extension/src/handlers/reads.ts`)
  saves only the status. The activity row can only say "Failed". Persist
  the reason on the entry and show it in the row or a detail view.
- [ ] **AO amounts in the activity list are labelled "AR".**
  `MainScreenView.tsx` formats every entry with `formatWinstonAsAr(...) AR`,
  including AO token sends and receives (`entry.token !== null`). Use the
  token's denomination and ticker (see `SendView.tsx`'s
  `formatAtomicAsDisplay` path).

## Known gaps (carried over from the old build log, re-checked in the code)

- [ ] **`getConnectedApps()` is a stub that always returns `[]`**
  (`apps/extension/src/handlers/reads.ts`). Grants are stored under
  `local:grants` by the approval flow. Either read them here, or confirm
  nothing calls this and remove it.
- [ ] **No way to add or discover AO tokens.** `getTokenBalances` reads
  `local:watchedProcessIds:{address}`, but nothing writes that key, so
  only the default AO token ever shows. Needs an "add token" flow (or
  discovery), plus storage.
- [ ] **Unregistered token names are dropped.** `withUnregisteredMetadata`
  (`reads.ts`) resolves ticker and denomination from spawn tags but not
  the name, and `TokenBalance` has no `name` field. So `userTokens()`
  never lists a discovered token.
- [ ] **Token metadata isn't cached.** `resolveUnregisteredTokenMetadata`
  hits the gateway on every `getTokenBalances` call. Spawn tags never
  change, so cache by processId in storage with no expiry.
- [ ] **HyperBEAM balance path is unverified.** `core/ao/balance.ts` uses
  `~process@1.0/compute/balances/{address}` only, with no `now/`
  fallback. Confirm against a live peer.
- [ ] **dApp `privateHash` and non-RSA-OAEP signing branches are
  unverified** against real Wander/ArConnect behavior (`core/vault/`).
  Check their output against a live Wander instance before relying on
  them.

## Cleanup

- [ ] **Remove the Hedgehog scaffolding** now that the build no longer
  uses it: `.hedgehog/`, the Hedgehog agents and skills in `.claude/`,
  `AGENTS.md`, and the per-layer file-naming conventions for tests (the
  `*.<layer>.test.ts` suffixes can stay; nothing depends on them any more).
  Keep `.hedgehog/core-design.md`'s useful content only if it isn't
  already in `CLAUDE.md`.
- [ ] **Stale doc comments** that still describe the old aoconnect-based
  AO send (search for "aoconnect" and "message()" across
  `apps/extension`).

## Unsorted

<!-- New findings go here until they're placed in the list above. -->
