## 2026-09-14T05:39:52.140Z

hedgehog verify has now twice committed a task's scope-approved files incompletely: files that exist on disk, pass the layer's verify command, and are covered by a recorded override still don't always land in the commit (messaging layer missed core/src/index.ts + ports.models.test.ts; onboarding-unlock missed 3 test files). In both cases the missing files were written to disk before the override was recorded but after the task was claimed. Worked around by independently re-confirming the files still pass verify and committing them directly as a fix(...) follow-up commit each time. Possible root cause: verify's touched-file detection may snapshot the diff at claim time or before an override is applied, rather than re-checking at verify time against the override's full current scope.

## 2026-09-14T05:40:21.047Z

hedgehog debt add writes a local cache mirror to .hedgehog/notes/<task-id>.json that isn't in the project's installed .gitignore alongside the DB's other derived state (hedgehog.db, graph-server.json, commit.lock) -- added it locally to this project's .gitignore, but this looks like a gap in what init/update installs by default.

## 2026-09-14T14:42:45.800Z

hedgehog plan re-compiles an already-complete, already-merged intent (design-system-pass, closed via reconciliation) into phantom 'planned' tasks every time its intent_dependencies clear (gleam-wallet complete) -- happens even after 'hedgehog abandon' records the abandonment, since plan doesn't check the abandoned record before re-evaluating dependency-clearing eligibility. Also: the first-eligible-intent worktree mechanism checks out from committed git refs, so a newly-added intent JSON must be committed before 'plan' can see it at all -- an uncommitted intent silently compiles 0 tasks while plan spins up a worktree for an unrelated, already-shipped intent instead. Worked around by abandoning + committing the abandonment record + committing the new intent before replanning; this session bypassed hedgehog claim/verify entirely for the resulting build (settings-screens-gap) and built+verified by hand instead, per explicit user direction to stop fighting the tool.

