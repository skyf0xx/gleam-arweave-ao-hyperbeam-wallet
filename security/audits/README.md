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

## Release flow

1. Write `v<version>.md` here and merge it to `master` in a PR.
2. On an up-to-date `master`, run `pnpm release --yes`. It runs the gate,
   then pushes a signed tag `v<version>`.
3. The tag starts `.github/workflows/release.yml`. It checks that the tag is
   annotated and signed by a key in `.github/allowed_signers`, that the
   commit is on `master`, that the tag matches the version, and that the
   gate passes at that commit. Then it builds the zip with `wxt zip`,
   attests its build provenance and publishes a GitHub Release with the zip
   and `release-manifest.json`.
4. Download the zip from the Release and check it against the manifest
   (`sha256sum <zip>` and `jq -r .zipSha256 release-manifest.json`; also
   `gh attestation verify <zip> --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet`).
5. Upload that zip to the Chrome Web Store by hand. CI has no store
   credentials.
