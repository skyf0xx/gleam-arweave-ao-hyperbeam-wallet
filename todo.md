# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## 5. Polish

- [ ] **AO transfer approval shows the raw atomic amount (S, 🧪, sonnet)**
  `entrypoints/approval/src/SigningApprovalScreen.tsx` `formatAmount`,
  `entrypoints/background/index.ts` `transferAoTokens` case. The preview
  has no token denomination, so it renders the smallest-unit integer.
  Done: the background puts the token's denomination (already read for
  balances) into the preview, and the amount shows as a decimal with the
  ticker. If the denomination can't be read, the raw amount is shown with
  a "smallest units" label rather than a guess.

## Not planned

- Wander's deprecated `{ algorithm, hash, salt }` encrypt/decrypt stays
  refused (`provider-params.ts` `readEncryptAlgorithm`). Wander deprecated
  it and no dApp has asked for it. Wander's source specifies it fully if
  that changes.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->

- `apps/extension/src/handlers/reads.ts` `userTokens`: a row whose
  denomination couldn't be confirmed still reports its placeholder
  `Denomination` (0 when the balance read failed). A dApp that scales by
  it will show a wrong amount; Wander's shape has no "unknown" value.
- `apps/extension/src/handlers/reads.ts` `userTokens`: `Logo` is never
  set, because `TokenBalance` doesn't carry the spawn-tag logo through.
