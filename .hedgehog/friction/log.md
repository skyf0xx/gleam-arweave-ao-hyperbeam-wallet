## 2026-09-14T05:39:52.140Z

hedgehog verify has now twice committed a task's scope-approved files incompletely: files that exist on disk, pass the layer's verify command, and are covered by a recorded override still don't always land in the commit (messaging layer missed core/src/index.ts + ports.models.test.ts; onboarding-unlock missed 3 test files). In both cases the missing files were written to disk before the override was recorded but after the task was claimed. Worked around by independently re-confirming the files still pass verify and committing them directly as a fix(...) follow-up commit each time. Possible root cause: verify's touched-file detection may snapshot the diff at claim time or before an override is applied, rather than re-checking at verify time against the override's full current scope.

## 2026-09-14T05:40:21.047Z

hedgehog debt add writes a local cache mirror to .hedgehog/notes/<task-id>.json that isn't in the project's installed .gitignore alongside the DB's other derived state (hedgehog.db, graph-server.json, commit.lock) -- added it locally to this project's .gitignore, but this looks like a gap in what init/update installs by default.

## 2026-09-14T14:42:45.800Z

hedgehog plan re-compiles an already-complete, already-merged intent (design-system-pass, closed via reconciliation) into phantom 'planned' tasks every time its intent_dependencies clear (gleam-wallet complete) -- happens even after 'hedgehog abandon' records the abandonment, since plan doesn't check the abandoned record before re-evaluating dependency-clearing eligibility. Also: the first-eligible-intent worktree mechanism checks out from committed git refs, so a newly-added intent JSON must be committed before 'plan' can see it at all -- an uncommitted intent silently compiles 0 tasks while plan spins up a worktree for an unrelated, already-shipped intent instead. Worked around by abandoning + committing the abandonment record + committing the new intent before replanning; this session bypassed hedgehog claim/verify entirely for the resulting build (settings-screens-gap) and built+verified by hand instead, per explicit user direction to stop fighting the tool.

## 2026-09-14T16:34:37.508Z

reviewed: 2026-09-15, issues: https://github.com/skyf0xx/hedgehog/issues/432, https://github.com/skyf0xx/hedgehog/issues/433, https://github.com/skyf0xx/hedgehog/issues/434

## 2026-09-16T01:18:29.616Z QR-CODE-REAL-ENCODER-WALLET-CORE

QR-CODE-REAL-ENCODER-WALLET-CORE's verify command (pnpm vitest run ... send ...) fails on a pre-existing, unrelated test: transfer.send.test.ts 'throws a named error when no active HyperBEAM peer is configured for an AO transfer'. Root cause: DEFAULT_NETWORK_SETTINGS.activePeerUrl defaults to DEFAULT_HYPERBEAM_PEER_URLS[0] (a real URL), so empty storage never produces settings.activePeerUrl === null -- the test's premise (empty storage implies no active peer) doesn't hold against the handler's own default-fallback behavior, introduced together in the original wallet-core commit (a3e41b8). Confirmed pre-existing and unrelated to qr-code-real-encoder by stashing this intent's QrCode.tsx changes and re-running 'pnpm vitest run send' against a clean wallet-core tree -- same failure. Needs a planner/Correction-Protocol decision: either the test's premise is wrong (should mock/force activePeerUrl to null explicitly rather than relying on empty-storage defaults), or the handler needs an explicit 'no peer usable' state distinct from 'falling back to public default peer'. Blocks QR-CODE-REAL-ENCODER-WALLET-CORE's own verify command from passing as-is.

## 2026-09-16T01:21:32.361Z QR-CODE-REAL-ENCODER-SETTINGS-SCREENS-GAP

QR-CODE-REAL-ENCODER-SETTINGS-SCREENS-GAP's verify command fails on a pre-existing, unrelated test: MainScreenView.main-screen.test.tsx 'shows NetworkErrorBanner (not a broken/blank chart) when getPortfolioHistory fails' -- times out waiting for /couldn't reach the network/i text. Confirmed pre-existing (reproduces on a clean stash of this intent's work, unrelated to qr-code-real-encoder). Looks like a real product-behavior gap (chart error state not rendering as expected), not a test-fixture bug like the earlier HyperBEAM-peer one -- needs actual investigation into MainScreenView/portfolio-chart error handling, not a task for this intent to absorb. Blocks QR-CODE-REAL-ENCODER-SETTINGS-SCREENS-GAP's own verify from passing as-is.

## 2026-09-16T02:19:32.883Z

This session repeatedly hand-verified/no-op'd layers where the messaging/provider-bridge scaffolding was clearly irrelevant (vault, onboarding-unlock, wallet-core, upload, settings-screens-gap, historical-pricing, main-screen-chart all no-op'd for both ao-provider-transfer-surface and forgot-password-wire-contract intents), and for upload-submit-relocation the user explicitly said it was fine to hand-fix the SQLite state directly rather than force 9 more no-op commits through claim/verify. Filed as github.com/skyf0xx/hedgehog issue for agent discretion over per-layer ceremony.

