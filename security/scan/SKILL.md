---
name: gleam-scan
description: Scan the latest Gleam wallet release for security issues, report what you find the right way (PR or private advisory), and produce a signed-by-the-user attestation that earns the user Gleam Points. Use when asked to scan, audit or security-review a Gleam release.
---

# Scan a Gleam release

The prompt a user pastes into their agent to start this skill:

> Scan the latest Gleam release for security issues by following security/scan/SKILL.md in https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet. The skill clones the repo, installs its pnpm dependencies (which add a lefthook git hook to the checkout), runs its tests and osv-scanner, and calls the Gleam Points API at api.gleamwallet.app. It never needs a seed phrase, a real key, a wallet or funds. Ask me before any gh action: forking, pushing, opening a PR or filing an advisory.

Gleam is a Chrome browser-extension wallet for Arweave and AO. In this
skill you check out its latest release, review the code where a bug could
leak a key or sign something the user didn't approve, report what you find,
and answer a short challenge that shows you read the code. At the end you
give the user a link. They open it, Gleam shows them the attestation, and
when they approve, their Gleam wallet signs it and earns Gleam Points. You
never sign anything, hold a key or touch a wallet. The user does that in
Gleam. The user needs a Gleam wallet that is registered for points, and the
wallet that signs gets the points.

## What this skill does on your machine

Every side effect of the scan, in one place. Nothing outside this list is
part of the skill.

- **Installs:** the repository's pnpm dependencies
  (`pnpm install --frozen-lockfile`). Its `prepare` script runs
  `lefthook install`, which adds a pre-commit hook to the scan checkout's
  `.git/hooks` and nowhere else. Optionally `osv-scanner` and `gitleaks`,
  through brew, go or a release binary (Prerequisites).
- **Writes:** the clone, the `.gleam-scan/` directory inside it (ignored
  by git), and a sibling git worktree for each fix (Step 7).
- **Network:** GitHub (clone, tags, the release lookup), the npm registry
  (install), the osv-scanner advisory database, and the Gleam Points API
  at `https://api.gleamwallet.app` (`pnpm scan start` and
  `pnpm scan finish`). `finish` sends the attestation: the challenge
  answers, the model id and the coverage report.
- **Acts as the user, only after asking:** `gh repo fork`, `git push`,
  `gh pr create`, and filing a private advisory (Step 8c). Each one is
  public or reaches the maintainers, so ask the user before each one.
- **Never:** reads a seed phrase, key, keyfile or wallet; signs anything;
  moves funds.

Follow the steps in order. Every command runs from the root of the checkout
unless a step says otherwise. Background on the program is in `SCANS.md`.

This skill has two companion files in the same directory. Each step says
when to read them:

- `security/scan/CHECKS.md`: what to look for, area by area (Steps 4
  and 5).
- `security/scan/VERIFY.md`: how to try to disprove a finding and rate
  what survives (Step 6). It stands on its own, so a fresh subagent can
  follow it.

## Rules that always apply

- Never use a seed phrase, a real key, a real wallet, or real funds. Test
  with generated keys and the unit tests only.
- Never put the details of a medium, high or critical issue anywhere public:
  not in the attestation `report`, a PR, an issue, a commit message or a
  comment. Those details go only in a private advisory.
- Never open a public GitHub issue for a security problem.
- If you find a secret in the repository (a key, token or password),
  report it in a private advisory with only its file and line. Never copy
  the value anywhere, including the advisory.
- Keep the scan checkout's `HEAD` on the release tag. `pnpm scan finish`
  fails if `HEAD` moves. Write any fix in a separate worktree (Step 7).
- When a `pnpm scan` command prints a line starting with `✗`, do what that
  line says, then run the command again.

## Prerequisites

First, before you clone or install anything, find the latest release.
"Latest" means the release GitHub marks as **Latest** (not a draft, not a
pre-release), which is what the points server uses. A git tag alone isn't
a release.

```bash
gh release view --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet --json tagName -q .tagName
# without gh:
curl -s https://api.github.com/repos/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/latest | grep '"tag_name"'
```

Either prints a tag such as `v1.26.0`. If `gh` prints `release not found`
or the curl prints `"status": "404"`, Gleam has no published release yet:
stop and tell the user there is nothing to scan. If you can't reach
GitHub's API at all, carry on; `pnpm scan start` checks the release for
you.

You need Node 22 or later, git, and pnpm through corepack:

```bash
node --version                 # v22.x or later
corepack enable                # provides the pnpm version pinned in package.json
```

Clone the repository, fetch its tags and check out the release:

```bash
git clone https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet.git gleam-scan
cd gleam-scan
git fetch --tags
git checkout v1.26.0           # the tag you found
```

If you couldn't reach GitHub's API, skip the checkout: if `HEAD` isn't the
latest release, `pnpm scan start` prints the exact command to run.

Read `security/scan/SKILL.md` from the checkout. If it differs from the
copy you started with, follow the checkout's copy: it is the version
reviewed and tagged with the release you are scanning, and the scan tools
and points server work to that version. Tell the user the tag and commit
you are following (`git rev-parse HEAD`), so they can read the same file.

Install the dependencies. This also installs the pre-commit hook in the
checkout:

```bash
pnpm install --frozen-lockfile
```

Install `osv-scanner` (used in Step 3): `brew install osv-scanner`, or
`go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`, or a
binary from https://github.com/google/osv-scanner/releases. If you can't
install it, use `pnpm audit` instead in Step 3 and say in the report that
osv-scanner wasn't run.

Install `gitleaks` (`brew install gitleaks`, or a binary from
https://github.com/gitleaks/gitleaks/releases) if you may commit a fix in
Step 7. The pre-commit hook refuses every commit without it.

Note the start time. The report says how long you spent:

```bash
mkdir -p .gleam-scan && date -u | tee .gleam-scan/started
```

Don't set `GLEAM_POINTS_API` or `GLEAM_SITE_URL` unless the user tells you
to. The defaults are the live Gleam servers.

## Step 1: Start the challenge

```bash
pnpm scan start
```

Done when it prints `✓ Challenge ready for Gleam v<release> (commit <sha>).`
and lists 3 functions, each as `<file>  <symbol>  lines <start>-<end>`. It
writes two files:

- `.gleam-scan/challenge.json`: the challenge. Don't edit it.
- `.gleam-scan/attestation.json`: a starter attestation you fill in at
  Step 8.

The challenge expires after 24 hours. Only the user's signature in Gleam
uses it up; `pnpm scan finish` doesn't. Run `start` only once. Running it
again replaces the challenge with new functions (it backs up your old
attestation to `.gleam-scan/attestation.<old challenge id>.json`).

## Step 2: Read the threat model

Read `docs/THREAT_MODEL.md` in full before any code. These are given, and
you build on them:

- **Attackers**: the attackers Gleam defends against. Every finding must
  name one of them.
- **Out of scope**: a compromised OS or browser, a user who gives away their
  keyfile or password, the security of AO processes, tokens or dApps, and
  other extensions with broad permissions. Not findings.
- **By design**: decisions Gleam made on purpose, each with a *Still a
  finding if* clause. A report that only restates a By design entry is
  closed. It is a finding only if you demonstrate, concretely, the harm its
  *Still a finding if* clause names. That holds for a path the clause
  didn't anticipate too: treat it as a finding and cite the clause.
- **Known limitations**: already known. Not findings.

Where the docs and the code disagree, the code is right. A docs mismatch
is a low finding, unless the mismatch is itself a medium or higher issue.
Fix a low one in a PR (Step 7).

Done when you can name the attackers and the By design entries.

## Step 3: Run the tests and the dependency scan

```bash
pnpm vitest run
osv-scanner scan --config osv-scanner.toml --lockfile pnpm-lock.yaml   # or, if unavailable: pnpm audit
```

The tests take a few minutes. osv-scanner may print `Starting filesystem
walk for root: /`; that is harmless. Done when both have finished and you
have noted the results. A test failure is not a finding by itself: the
report says only that tests failed. If a failure points at a security
issue, treat it as a finding under the severity rules. A vulnerable dependency
is a finding only if Gleam uses the affected code in a way an attacker from
the threat model can reach; otherwise note it in the report.
`osv-scanner.toml` lists the advisories Gleam already knows about, each
with the reason it can't be reached. One of those is a finding only if you
show the reason is wrong.

CI already runs semgrep with the `p/typescript`, `p/javascript`, `p/react`
and `p/secrets` rulesets, so running those again finds nothing new. If you
have semgrep, write your own rules for patterns specific to Gleam instead,
for example a page-supplied value reaching a signing call without going
through its zod schema. This is optional. Say in the report whether you
ran any.

## Step 4: Review the security surface, changed files first

`security/surface.txt` lists the security-surface files, one per line as
`<tier> <path>`. Tier 1 is the most severe. A path ending in `/` covers the
whole directory.

Find the previous release tag (empty if this is the first release):

```bash
PREV=$(git tag --list 'v*' --merged HEAD --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 2p)
echo "previous release: ${PREV:-none}"
```

List the surface files changed since then (all of the surface if there is
no previous release). This works in bash and zsh; `git` expands the
directory entries:

```bash
if [ -n "$PREV" ]; then git diff --name-only "$PREV" HEAD -- $(awk '!/^#/ && NF == 2 { print $2 }' security/surface.txt); else git ls-files -- $(awk '!/^#/ && NF == 2 { print $2 }' security/surface.txt); fi
```

See what changed in each file with `git diff "$PREV" HEAD -- <file>`.

Review the changed files first, in tier order (1 before 5), and within a
tier read non-test source before tests. With no previous release, every
surface file counts as changed: skip `*.test.ts` files and `pnpm-lock.yaml`
(Step 3 covers the lockfile). Then review the rest of the surface, again in
tier order. List it all with:

```bash
git ls-files -- $(awk '!/^#/ && NF == 2 { print $2 }' security/surface.txt)
```
Read the 3 challenge functions closely on the way, since you answer for
them in Step 8.

For what to look for, read `security/scan/CHECKS.md`. Section 1 has the
questions for each area of the surface. Section 2 has the classes of bug
that cut across areas; keep them in mind in every file.

Each time you hit something you can't settle, note it as a lead in
`.gleam-scan/leads.md` (`.gleam-scan/` is ignored by git) with its file
and line, and keep going. Step 6 turns the leads into candidates.

Done when you have read every changed surface file (as above) and as much
of the rest as you can, and you know which files you didn't reach.

## Step 5: Look anywhere else that seems worth it

The surface list and `CHECKS.md` are where to start, not the limit.
Follow data and calls out of the surface wherever they lead: callers,
message handlers, the build config, anything you suspect. A finding
outside the surface counts the same as one inside it.

Work through `CHECKS.md` Sections 3 to 5: the wildcard questions, the
literal list of obvious things (with its own search), and the cases the
tests don't cover.

To find more leads, search the whole repository (not only the surface)
for these, and check each hit that handles key material or page input:

```bash
git grep -nE 'crypto\.subtle|exportKey|importKey|storage\.local|storage\.session|postMessage|innerHTML|insertAdjacentHTML|data:|downloads\.' -- '*.ts' '*.tsx' '*.js' '*.mjs' ':!*.test.ts' ':!*.test.tsx'
```

It prints about 200 lines, so skip the ones you have already read.

To show that a suspected bug is real, write a throwaway unit test, for
example one that feeds a malformed or oversized binary value to the
decoder in `page-protocol.ts`, and run it with `pnpm vitest run
<path-fragment>`. A failing test turns "suspected" into "demonstrated".
Delete the test afterwards. For a low finding it can go in your fix PR;
for a medium or higher one it stays local or goes in the advisory. Never
test against a real wallet.

If a file you reviewed here can leak a key, sign something unapproved or
let a page past the wallet's boundary, it belongs on the surface. Note it
for the surface PR in Step 7.

Done when you have followed the leads you found.

## Step 6: Try to disprove each finding

Go through `.gleam-scan/leads.md`. Drop each lead you have since settled
as safe. Write each one left as a candidate note,
`.gleam-scan/candidates/1.md`, `2.md` and so on. A note gives the six
fields of the bar in `security/scan/VERIFY.md` (attacker, entry,
control, boundary, harm, evidence), the `file:line` steps of the trace,
and the throwaway test if you wrote one.

Then put every candidate through `VERIFY.md`:

- **If your agent can start a subagent**, start a fresh one for each
  candidate. Give it only the checkout path and this instruction:
  "Follow security/scan/VERIFY.md for the candidate in
  .gleam-scan/candidates/<n>.md, and return the verdict block it
  describes." Don't pass it your own reasoning. A verifier that starts
  from your conclusion finds what you found. You can run several at
  once.
- **Otherwise**, verify each candidate yourself, one at a time. Follow
  `VERIFY.md` from its first step, and re-read every cited line as if
  someone else had written the note.

Act on each verdict:

| Verdict | Do |
| --- | --- |
| `holds` | Draft it in Step 7 at the severity the verdict gives. |
| `holds, weaker` | Apply the **Corrections** to the note, then draft it at the lower severity. |
| `needs a browser check` | Draft it at the severity the verdict gives, and say in the draft that it is unconfirmed and which fact a maintainer has to check. |
| `refuted` | Drop it. If the reason shows the threat model or `CHECKS.md` misled you, note that for a skill PR in Step 7. |

If you disagree with a subagent's verdict, don't overrule it. Start one
more fresh verifier and give the candidate to it. If the two still
disagree, take the lower severity, or `refuted` if one of them refuted
it.

Done when every candidate has a verdict.

## Step 7: Draft your reports (don't file them yet)

Draft each candidate that survived Step 6, at the severity its verdict
gives:

- **Low or informational, or a hardening change:** draft a PR.
- **Medium, high or critical:** draft a private advisory. If you're unsure
  whether it's low or medium, treat it as medium.

Draft everything first, and file nothing yet. Every PR and advisory,
skill and surface PRs included, quotes the attestation id, which only
exists after Step 8. Write `{{ATTESTATION_ID}}` in its place. The id goes
in PR and advisory bodies, never in a commit message.

**PR draft.** Write the fix in a separate worktree, so the scan checkout
stays on the tag. Base it on `origin/master` if the file to fix exists
there, else on the release tag (say so in the PR's **What**):

```bash
git fetch origin master
BASE=origin/master
git cat-file -e origin/master:<file> || BASE=HEAD   # HEAD is the release tag
git worktree add -b fix/security-<short-name> ../gleam-fix-<short-name> "$BASE"
cd ../gleam-fix-<short-name>
pnpm install --frozen-lockfile    # a new worktree has no node_modules
# make the change, add or update a test, then:
pnpm vitest run <path-fragment>
git add -A && git commit -m "fix(security): <what the change does>"
```

The pre-commit hook runs gitleaks, eslint and tsc on all six projects. If
it fails, fix what it names and commit again.

- Title: a Conventional Commit, `fix(security): <what it fixes>`
  (`docs(security): …` for a docs-only fix).
- Body: follow `.github/PULL_REQUEST_TEMPLATE.md`. Fill **Why** and
  **What**. The **Attestation id** section gets
  `Attestation id: {{ATTESTATION_ID}}`. Tick only the Checklist boxes you
  ran; leave the rest unticked and say why in the body.
- Low details may be public. Medium-and-above details never go in a PR,
  even one that fixes them.

**Advisory draft.** Write a title, the severity, and a description with:
the attacker (from the threat model), the affected files or flow, the steps
from the attacker's access to the harm, the impact, and the evidence from
the verdict: demonstrated, traced, or the exact fact a browser check has
to settle. Keep the draft local, for example in
`.gleam-scan/advisory-1.md`.

**Skill or surface PR.** This skill improves through the scans that use
it. If something would have made your scan better, draft a PR for it, in
its own worktree like a fix PR. For example:

- a file that belongs in `security/surface.txt`. Add it at its tier, and
  add the same path to `.github/CODEOWNERS` (a test keeps the two
  identical);
- an area, check, search or tool that `CHECKS.md` should name;
- a reason to refute, or a severity example, that `VERIFY.md` should
  give;
- a command in this skill that failed or misled you, or a `✗` message
  that didn't say what to do.

Title it `docs(scan): <what it improves>`, and fill the template's **Why**
with what happened in your scan. Keep it general: a skill PR never
describes a vulnerability, not even a low one. If it comes from a medium
or higher finding (a surface entry alone points at the bug), don't file it
until the advisory is fixed. It doesn't change
`result`. A maintainer reviews it like any other PR, and nothing merges
automatically.

Done when every surviving finding and skill suggestion has a draft. If
nothing survived Step 6, that's a clean scan.

## Step 8: Answer the challenge, finish, then file

### 8a. Fill in `.gleam-scan/attestation.json`

`pnpm scan start` wrote this starter:

```json
{
  "challenge": "<challenge id>",
  "model": "",
  "answers": [
    { "file": "<file>", "symbol": "<symbol>", "line": 0, "check": "" },
    { "file": "<file>", "symbol": "<symbol>", "line": 0, "check": "" },
    { "file": "<file>", "symbol": "<symbol>", "line": 0, "check": "" }
  ],
  "result": "pass",
  "report": ""
}
```

Fill it in field by field:

- `challenge`: leave as written.
- `release`, `commit`: leave out. `pnpm scan finish` fills them from git.
- `model`: your exact model id, such as `claude-opus-5-5`. 1 to 64
  printable ASCII characters, no leading or trailing space. It's a
  self-reported label, shown publicly, with no effect on points.
- `answers`: exactly 3, one per challenge function. Keep `file` and
  `symbol` as written. For each:
  - `line`: the 1-based line number of a security check that the function
    makes. It must be in the function's body: not the signature or
    parameter lines, not the closing `}`, not a blank line, not a comment,
    not a line of only punctuation such as `});`. Pick a line that makes the
    check, such as an `if (...)`, a `throw`, or a `return` that rejects. If
    the function only delegates or dispatches, pick the line that rejects or
    validates its input, such as a `default:` case's `throw` or a `.filter`.
    Line numbers are those of the file at the release commit. Get them
    with:

    ```bash
    git show HEAD:<file> | cat -n | sed -n '<start>,<end>p'
    ```

    using the `lines <start>-<end>` that `pnpm scan start` printed.
  - `check`: one sentence, 10 to 300 characters, on one line, on what that
    check prevents. Write it from what you read, about this code.
- `result`: `"pass"` if you drafted no fix PR or advisory in Step 7,
  `"scanned"` if you drafted at least one. A skill or surface PR doesn't
  count either way. It never says what you found, and
  both earn the same.
- `report`: markdown, at most 20,000 characters, `\n` line endings. It
  describes **coverage only**: what you checked, what you didn't, the tools
  you ran and their outcome in general terms, how many candidates Step 6
  verified and whether subagents verified them, and how long you spent
  (`cat .gleam-scan/started; date -u`, then subtract). Never
  vulnerability details, not even for a low finding. "Filed 1 PR and 1
  advisory" is fine. What they are about is not.

### 8b. Run `pnpm scan finish` until it passes

```bash
pnpm scan finish          # or: pnpm scan finish --json
```

It checks the attestation locally, then asks the points server to run the
same checks. Each problem prints as one line, `✗ <field>: <what to
change>`. Fix each one in `.gleam-scan/attestation.json` and run it again.
On success it prints the lines below, sometimes after a `Replaced …`
note. Read the id from the `Attestation id:` line:

```text
✓ Attestation valid for Gleam v<release>.
Attestation id: <64 hex characters>
Paid places left: <n>
Put the attestation id <id> in every PR and advisory you filed for this scan.
Link: https://gleamwallet.app/attest.html#<payload>
Tell the user: Open this link in Chrome with Gleam installed and click Sign with Gleam; it signs no transaction and moves no funds.
```

`finish` rewrites `.gleam-scan/attestation.json` with `release` and
`commit` filled in; that doesn't change the id. You can run `finish` again
at any time, for example after you edit the report. It doesn't use up the
challenge, and only the id from the last run counts.

### 8c. Get the signature, then file the drafts

The attestation id is the SHA-256 of the attestation's content, so it
changes if any field changes. In this order:

1. Give the user the `Link:` and the sentence after `Tell the user:`, and
   ask them to sign now. The challenge expires 24 hours after
   `pnpm scan start`.
2. Wait until the user confirms that Gleam accepted the signature. Don't
   edit `.gleam-scan/attestation.json` after that.
3. In every draft from Step 7, replace `{{ATTESTATION_ID}}` with the id
   from the last `pnpm scan finish`. Then file it.

If the challenge expires first, follow its Troubleshooting row and give
the user the new link. If signing can't succeed (see the end of
Troubleshooting), still file every draft, without the `Attestation id:`
line.

**File a PR** (needs `gh` signed in to the user's GitHub account; ask the
user first):

```bash
cd ../gleam-fix-<short-name>
gh repo fork --remote --remote-name fork      # forks origin, adds the fork as remote "fork"
git push fork HEAD
gh pr create --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet --base master \
  --head <your-github-login>:fix/security-<short-name> --title "fix(security): <what it fixes>" --body-file <your filled-in template>
```

In the body, the template's `## Attestation id` section holds the line
`Attestation id: <id>`.

**File a private advisory** (the private vulnerability report from
`SECURITY.md`): open
https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security/advisories/new,
or with `gh`:

```bash
gh api repos/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security-advisories/reports \
  -f summary="<title>" -f severity="<low|medium|high|critical>" \
  -f description="$(cat .gleam-scan/advisory-1.md)"
```

The description includes the line `Attestation id: <id>`.

If you can't file (no `gh`, or the user would rather do it), give the user
each draft, ready to paste, with the id already in it. Never publish an
advisory's text anywhere else.

Done when the user has signed and every draft is filed, or handed to the
user, with the id in it.

## Report like a working security engineer

- Every finding meets the bar in `VERIFY.md`: a realistic attacker from
  the threat model, and concrete steps from the attacker's access to the
  harm. An attack that needs a compromised OS, malware, or the user's
  password is out of scope.
- Rate severity with the anchors in `VERIFY.md`: by what you showed, not
  the worst case you can imagine.
- Missing defence in depth is not a finding unless it enables a real
  attack.
- Say once whether a finding was demonstrated, traced or needs a browser
  check, then write plainly.
- A clean `pass` earns the same as `scanned`. Padding a report with weak
  findings earns nothing.

Never use a seed phrase, a real key, a real wallet, or real funds.

## Example attestation

A filled-in attestation for a clean scan, after `pnpm scan finish` filled
`release` and `commit`. The challenge id, commit and line numbers are
illustrative; use the ones from your own challenge and checkout.

```json
{
  "challenge": "q7Vd2LxN0aRk5TbW9cYhJm3sPe8uGf1z",
  "model": "claude-opus-5-5",
  "answers": [
    {
      "file": "apps/extension/src/sender.ts",
      "symbol": "contentScriptOrigin",
      "line": 37,
      "check": "Refuses messages from any frame but the top one, so an embedded iframe can't speak for the page's origin."
    },
    {
      "file": "apps/extension/src/sender.ts",
      "symbol": "isSecureSigningOrigin",
      "line": 68,
      "check": "Allows plain http only on loopback hosts, so a page a network attacker can inject into can't ask for a signature."
    },
    {
      "file": "apps/extension/src/handlers/provider-params.ts",
      "symbol": "readAtomicAmount",
      "line": 170,
      "check": "Rejects a transaction amount that isn't a whole number of Winston before it reaches signing."
    }
  ],
  "result": "pass",
  "report": "## Coverage\n\n- Read docs/THREAT_MODEL.md in full.\n- Ran `pnpm vitest run`: all tests passed.\n- Ran `osv-scanner scan --config osv-scanner.toml --lockfile pnpm-lock.yaml`: no advisories that Gleam's code reaches.\n- Reviewed the 6 surface files changed since v1.25.0 line by line, tiers 1-3 first.\n- Reviewed the rest of tiers 1-3 (vault, keys, key session, background, content, provider, sender).\n- Skimmed tier 4 (approval window) and tier 5 (wxt.config.ts, CI workflows).\n\n## Not covered\n\n- Tier 5 release scripts and pnpm-lock.yaml beyond osv-scanner.\n- The popup screens outside the surface.\n- Nothing run in a real browser.\n\nFiled nothing. About 2 hours.",
  "release": "1.26.0",
  "commit": "84f6449691277f9af52fd0be17957541e02cd8d9"
}
```

For a scan that filed a PR and an advisory, `result` is `"scanned"` and the
report says, for example, "Filed 1 PR and 1 private advisory", with
nothing about what they contain.

## When you're done

Tell the user the attestation id, which PRs and advisories you filed (or
the drafts for them to file), and, if `finish` printed a warning that no
paid places are left, that the scan is recorded but earns no points.

## Troubleshooting

Each `✗` line already says what to do. The common ones:

| You see | Do |
| --- | --- |
| `✗ network: Couldn't reach …` | Check the connection, then run the command again. |
| `✗ rate_limited: … wait N seconds …` | Wait that long, then run it again. |
| `✗ http_404: … has no /scan/challenge endpoint …` | Community scans aren't live on that server. Tell the user; if they set `GLEAM_POINTS_API`, check it. |
| `✗ http_5xx: The points API had a server error …` | Wait a few minutes, then run it again. |
| `✗ http_<code>: … with no explanation …` | Stop and tell the user; it's a bug to report. |
| `✗ $: Gleam couldn't read the release from GitHub …` | Wait a minute, then run it again. |
| `✗ release: Gleam hasn't published a release yet …` | Nothing to scan yet. Tell the user. |
| `✗ $: v<x> has fewer than 3 security functions …` | The challenge pool is broken. Tell the user. |
| `✗ git: HEAD is … but the latest release is v<x> …` (start) | Run the `git fetch --tags && git checkout v<x> && pnpm install --frozen-lockfile` it prints, then `pnpm scan start`. |
| `✗ git: … has no v<x.y.z> release tag` or `✗ commit: HEAD is … but the challenge is for …` (finish) | Your `HEAD` moved off the tag. Run `git checkout v<release>` in the scan checkout, then `pnpm scan finish`. |
| `✗ <file>: \`<symbol>\` isn't in <file> at <sha> …` (start) | Run `git fetch --tags` and `pnpm scan start` again; if it repeats, tell the user. |
| `✗ .gleam-scan/challenge.json: There is no challenge yet …` | Run `pnpm scan start` (from the checkout root). |
| `✗ .gleam-scan/attestation.json: … isn't valid JSON at line L, column C …` | Fix the JSON syntax there. |
| `✗ model: …` | Set `model` to your model id: printable ASCII, 1 to 64 characters. |
| `✗ report: …` | Write the coverage report; `\n` line endings, no control characters. |
| `✗ result: …` | Set it to `"pass"` or `"scanned"`. |
| `✗ <key>: <key> isn't part of the attestation format …` | Remove that key. |
| `✗ answers[i].line: … is 0 …`, `… is a comment`, `… is blank`, `… holds only punctuation`, `… is in the signature …`, `… is outside …`, `… closes …` | Pick another line inside the body range the message gives, one that makes a check. Count lines with `git show HEAD:<file> \| cat -n`. |
| `✗ answers[i].check: …` | One sentence, 10 to 300 characters, one line, no leading or trailing space. |
| `✗ answers[i].symbol: …` or `✗ answers[i]: … isn't in the challenge …` or `✗ answers: No answer names …` | Restore `file` and `symbol` exactly as `pnpm scan start` wrote them; one answer per challenge function. |
| `✗ challenge: The challenge expired …` or `This challenge expired` / `was already used` / `id is unknown` / `was issued for …` | Run `pnpm scan start`, answer the 3 new functions, copy `model`, `result` and `report` from the backup `.gleam-scan/attestation.<old challenge id>.json`, and run `pnpm scan finish`. The id changes: give the user the new link. |
| `✗ release: v<x> isn't the latest release (v<y> is) …` | A new release came out. Check out `v<y>`, run `pnpm scan start` and scan that release. |
| `✗ attestationId: The server computed a different attestation id …` | Your checkout's scan tools are out of date. Run `git fetch --tags`, check out the latest release again, and rerun `pnpm scan finish`. |
| `✗ scan: Unexpected error …` | Run it again; if it repeats, tell the user. |

If the user reports an error after opening the link: "isn't registered for
Gleam Points" means they register the wallet in Gleam → Points and sign
again; "hasn't checked in during the last 3 days" means they open Gleam,
then sign again; "already attested" means this wallet already attested this
release, and another wallet or the next release is needed.
