# Security audits

Every Gleam release is reviewed before it is tagged. The review covers each
change to the [security surface](../surface.txt) since the previous audit:
the files where a bug can leak a key, sign something the user didn't approve,
or let a page past the wallet's boundary.

The result is one file per release, `v<version>.md`, in this directory. The
release script refuses to tag a version unless:

- `v<version>.md` exists and its `version` matches `apps/extension/package.json`;
- its `commit` is an ancestor of the commit being tagged;
- no surface file changed between that `commit` and the tagged commit;
- no finding is `open` with severity `critical` or `high`.

A surface change after the audit means the audit no longer describes what
ships, so it has to be extended to the new commit before the release.

## Format

Copy [TEMPLATE.md](TEMPLATE.md). The frontmatter fields:

| Field       | Value                                                              |
| ----------- | ------------------------------------------------------------------ |
| `version`   | The release version, without the `v`.                              |
| `commit`    | Full 40-character sha the review covered up to.                    |
| `previous`  | Full sha of the previous audit's `commit`, or `none` for the first. |
| `date`      | Date the review finished, `YYYY-MM-DD`.                            |
| `reviewers` | List of who or what reviewed it, e.g. `["/security-review", "Will (manual)"]`. |

The body has three sections. **Scope** gives the diff range
(`previous..commit`) and the surface paths it changed. **Findings** is a
table with the columns `id`, `severity` (`critical`, `high`, `medium`, `low`,
`info`), `summary` and `status` (`fixed`, `accepted`, `open`). **Notes** holds
anything else a reader needs, such as why an accepted finding is acceptable.

## Commands

```bash
pnpm release:check   # run the gate only
pnpm release         # all checks, then print what it would tag (dry run)
pnpm release --yes   # tag v<version> (signed) and push that tag
```
