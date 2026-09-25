# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## 5. Polish

- [ ] **`userTokens` reports a placeholder `Denomination` it couldn't confirm (S, sonnet)**
  `apps/extension/src/handlers/reads.ts` `userTokens`. When the
  denomination read fails, the row still sends a placeholder (0), and a
  dApp that scales by it shows a wrong amount. Done: `Denomination` is
  left out of a row whose denomination is unconfirmed, so a dApp sees
  "missing" instead of a wrong number. Everything else in the row is
  unchanged.

## Not planned

- Wander's deprecated `{ algorithm, hash, salt }` encrypt/decrypt stays
  refused (`provider-params.ts` `readEncryptAlgorithm`). Wander deprecated
  it and no dApp has asked for it. Wander's source specifies it fully if
  that changes.
- `userTokens` doesn't set `Logo` (`reads.ts`): `TokenBalance` doesn't
  carry the spawn-tag logo, and no dApp has asked for it.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->
