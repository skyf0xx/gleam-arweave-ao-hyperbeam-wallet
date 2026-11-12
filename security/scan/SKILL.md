---
name: gleam-scan
description: Scan the latest Gleam wallet release for security issues, one area per round, report what you find the right way (PR or private advisory), and produce attestations the user signs once, at the end, to earn Gleam Points. Use when asked to scan, audit or security-review a Gleam release.
---

# Scan a Gleam release

The prompt a user pastes into their agent to start this skill:

> Scan the latest Gleam release for security issues by following security/scan/SKILL.md in https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet. The skill clones the repo, installs its pnpm dependencies (which add a lefthook git hook to the checkout), runs its tests and osv-scanner, and calls the Gleam Points API at api.gleamwallet.app. It never needs a seed phrase, a real key, a wallet or funds. Ask me before any gh action: forking, pushing, opening a PR or filing an advisory.

Gleam is a Chrome browser-extension wallet for Arweave and AO. In this
skill you check out its latest release, review the code where a bug could
leak a key or sign something the user didn't approve, report what you find,
and answer a short challenge that shows you read the code. PRs are the main
thing a scan leaves behind: a fix, a test that pins a security property, a
surface entry, or a better check in this skill. At the end you give the user
one link. They open it, Gleam shows them each attestation, and when they
approve, their Gleam wallet signs it and earns Gleam Points. You never sign
anything, hold a key or touch a wallet. The user does that in Gleam. The
user needs a Gleam wallet that is registered for points, and the wallet
that signs gets the points.

A scan runs in **rounds**. Each round covers one **area**: the files of
one tier of `security/surface.txt`. The areas are `keys` (Key material),
`signing`, `boundary` (Trust boundary), `preview` (Approval preview) and
`build` (Build and release). A wallet scans each area once per release.
Round 2 earns 110% of the base reward, round 3 120%, and so on. After each
round you offer the user another round or filing. The user signs every
round at once, with one link, when they reply "file".

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
  at `https://api.gleamwallet.app` (the `pnpm scan` commands).
  `pnpm scan finish` and `pnpm scan file` send each attestation: the
  challenge answers, the model id and the coverage report.
- **Acts as the user, only after asking:** `gh repo fork`, `git push`,
  `gh pr create`, and filing a private advisory (File the reports). Each
  one is public or reaches the maintainers, so ask the user first. The
  sign request that `pnpm scan file` prints is that one question. The
  user's "signed" reply covers every draft of the rounds they signed.
- **Never:** reads a seed phrase, key, keyfile or wallet; signs anything;
  moves funds.

Every command runs from the root of the checkout unless a step says
otherwise. Background on the program is in `SCANS.md`.

This skill has three companion files in the same directory. Each step says
when to read them:

- `security/scan/CHECKS.md`: what to look for, area by area (Steps 4
  and 5).
- `security/scan/VERIFY.md`: how to try to disprove a finding and rate
  what survives (Step 6). It stands on its own, so a fresh subagent can
  follow it.
- `security/scan/REPORT.md`: how to write an advisory or a PR body
  (Step 7).

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
- Keep the scan checkout's `HEAD` on the release tag. The `pnpm scan`
  commands fail if `HEAD` moves. Write any fix in a separate worktree
  (Step 7).
- When a `pnpm scan` command prints a line starting with `✗`, do what that
  line says, then run the command again. If the line says to end the turn
  with the message below, end it with that closing message instead.
- Once a round's `pnpm scan finish` has passed, every turn ends with a
  closing message (Closing messages).

## Closing messages

A `pnpm scan` command that ends a turn prints this line, a blank line,
then the closing message:

```text
Show the user exactly this, as the last thing you write:
```

With `--json`, `closingHeader` holds that line and `userMessage` the
closing message.

Once a round's `pnpm scan finish` has passed, every turn ends like this:

1. The last command you run in the turn is a `pnpm scan` command that
   printed a closing message. Replies says which one. If you ran several,
   only the last one's message counts. The one exception is in If a
   command keeps failing.
2. Above it you write only what this skill names: filed links, drafts
   or `Attestation id:` lines handed to the user, an answer of one to
   three lines, a warning the command printed, the fix-bonus lines
   (Step 7), or the new-session line (Subagents).
3. Then that closing message, word for word, as printed. It is the last
   thing you write. No summary, tip, question or sign-off comes after it.

There are three kinds:

- **Round offer** (`finish`, `next`): what the next round earns and which
  area it scans. The user replies "next" or "file".
- **Sign request** (`file`, `next`): the link to sign the waiting rounds.
  The user replies "signed".
- **Every area done** (`finish`, `start`, `next`): no area is left to
  scan, so the reply is "file", or nothing is left at all.

## How a session runs

Everything a round needs is on disk in its **round folder**,
`.gleam-scan/rounds/<area>/`, where `<area>` is the area id `pnpm scan
start` printed. Replace `<area>` in every command below with that id.

**First round.** Prerequisites, then Steps 1 to 8. Step 8 ends the turn
with the round offer.

**Later rounds.** Steps 1 and 4 to 8. Steps 2 and 3 already ran; their
results are in `.gleam-scan/setup.md`.

**With subagents.** If your agent can start a subagent with a fresh
context, each round's review runs in one (Subagents). Run Prerequisites
and Step 3 yourself, once. Then each round is: Step 1, the round
subagent, a verifier per candidate, a draft subagent per surviving
candidate, then `result` and `pnpm scan finish` (Subagents, step 4).

**Resumed session.** If `.gleam-scan/rounds/` already exists in the
checkout, `cd` into the checkout and skip Prerequisites and Steps 2 and 3.
The user's reply is what follows `My reply:` in their message. First look
for an open round, one that hasn't passed `pnpm scan finish`:

```bash
for d in .gleam-scan/rounds/*/; do [ -e "${d}finished.json" ] || [ -e "${d}signed.json" ] || echo "open: $d"; done
```

If it prints a folder, finish that round first: Steps 4 to 8 for its
area, reusing the leads, candidates, drafts and answers already in the
folder, through `pnpm scan finish --area <area>`. Then act on the reply
(Replies). `.gleam-scan/declines` keeps the count of unanswered sign
requests across sessions.

## Prerequisites

Run these once per checkout.

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

Don't set `GLEAM_POINTS_API` or `GLEAM_SITE_URL` unless the user tells you
to. The defaults are the live Gleam servers.

## Step 1: Start a round

```bash
pnpm scan start                    # the least-covered area with no round in this checkout
pnpm scan start --area signing     # only when the user named an area: keys, signing, boundary, preview or build
```

Done when it prints `✓ Challenge ready for Gleam v<release> (commit <sha>).`,
then `Area: <label> (<id>, tier <n>).` with the area's files, 3 functions
from those files, each as `<file>  <symbol>  lines <start>-<end>`, the
`Started:` time and `Round folder: .gleam-scan/rounds/<area>/`. It writes:

- `.gleam-scan/rounds/<area>/challenge.json`: the challenge. Don't edit it.
- `.gleam-scan/rounds/<area>/area-files.txt`: the area's files, one per
  line.
- `.gleam-scan/rounds/<area>/attestation.json`: a starter attestation you
  fill in at Step 8.
- `.gleam-scan/current`: the area id. `pnpm scan finish` without `--area`
  acts on it.

The challenge expires 72 hours after `pnpm scan start`. Only the user's
signature uses it up. Running `start` again for the same area replaces
the challenge with new functions and backs up the old attestation to
`.gleam-scan/rounds/<area>/attestation.<old challenge id>.json`.

If `start` prints `✗ area: Every area of v<x> is scanned in this
checkout …`, end the turn with the closing message it printed.

## Step 2: Read the threat model

The agent that reviews the area does this: you, or the round subagent.

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

Run this once per checkout.

```bash
pnpm vitest run
osv-scanner scan --config osv-scanner.toml --lockfile pnpm-lock.yaml   # or, if unavailable: pnpm audit
```

The tests take a few minutes. osv-scanner may print `Starting filesystem
walk for root: /`; that is harmless. A test failure is not a finding by
itself: the report says only that tests failed. If a failure points at a
security issue, treat it as a finding under the severity rules. If you can
trace a failure to the test code rather than to your environment, for
example a fixture that only a lenient runtime accepts, draft a test PR for
it in Step 7. A vulnerable dependency is a finding only if Gleam uses the
affected code in a way an attacker from the threat model can reach;
otherwise note it in the report. `osv-scanner.toml` lists the advisories
Gleam already knows about, each with the reason it can't be reached. One
of those is a finding only if you show the reason is wrong.

CI already runs semgrep with the `p/typescript`, `p/javascript`, `p/react`
and `p/secrets` rulesets, so running those again finds nothing new. If you
have semgrep, write your own rules for patterns specific to Gleam instead,
for example a page-supplied value reaching a signing call without going
through its zod schema. This is optional.

Write the results to `.gleam-scan/setup.md`: the tag and commit, the test
outcome, which dependency scanner ran and its outcome, and whether you ran
semgrep rules. Every round's report reuses it.

Done when both have finished and `.gleam-scan/setup.md` holds the results.

## Step 4: Review your area, changed files first

`security/surface.txt` lists the security-surface files, one per line as
`<tier> <path>`. Tier 1 is the most severe. A path ending in `/` covers the
whole directory. Your area is one tier, and `pnpm scan start` saved its
files to `.gleam-scan/rounds/<area>/area-files.txt`.

Find the previous release tag (empty if this is the first release):

```bash
PREV=$(git tag --list 'v*' --merged HEAD --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed -n 2p)
echo "previous release: ${PREV:-none}"
```

List your area's files changed since then (all of them if there is no
previous release). This works in bash and zsh:

```bash
if [ -n "$PREV" ]; then git diff --name-only "$PREV" HEAD -- $(cat .gleam-scan/rounds/<area>/area-files.txt); else cat .gleam-scan/rounds/<area>/area-files.txt; fi
```

See what changed in each file with `git diff "$PREV" HEAD -- <file>`.

Review the changed files first, then the rest of the area's files. Skip
`pnpm-lock.yaml` (Step 3 covers it). Follow anything they reach out of the
area: callers, handlers, other tiers. With time left, review the rest of
the surface in tier order (1 before 5). List it all with:

```bash
git ls-files -- $(awk '!/^#/ && NF == 2 { print $2 }' security/surface.txt)
```

Read the 3 challenge functions closely on the way, since you answer for
them in Step 8.

For what to look for, read `security/scan/CHECKS.md`. Section 1 has the
questions for each part of the surface, marked by tier; start with your
area's tier. Section 2 has the classes of bug that cut across areas; keep
them in mind in every file.

Each time you hit something you can't settle, note it as a lead in
`.gleam-scan/rounds/<area>/leads.md` with its file and line, and keep
going. Step 6 turns the leads into candidates.

Done when you have read every changed file of your area and as much of
the rest of it as you can, and you know which files you didn't reach.

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

Go through `.gleam-scan/rounds/<area>/leads.md`. Drop each lead you have
since settled as safe. Write each one left as a candidate note,
`.gleam-scan/rounds/<area>/candidates/1.md`, `2.md` and so on. A note
gives the six fields of the bar in `security/scan/VERIFY.md` (attacker,
entry, control, boundary, harm, evidence), the `file:line` steps of the
trace, and the throwaway test if you wrote one.

Then put every candidate through `VERIFY.md`:

- **If your agent can start a subagent**, start a fresh one for each
  candidate. Give it only this prompt, with the paths filled in:
  "In the Gleam checkout at <absolute checkout path>, follow
  security/scan/VERIFY.md for the candidate in
  .gleam-scan/rounds/<area>/candidates/<n>.md, and return the verdict
  block it describes." Don't pass it your own reasoning. A verifier that
  starts from your conclusion finds what you found. You can run several
  at once.
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

Then check each candidate that survived against `origin/master`. You
scan the release tag, and master may already have fixed it:

```bash
git fetch origin master
git log --oneline HEAD..origin/master -- <file>   # HEAD is the release tag
git show origin/master:<file>                     # read the cited lines there
```

If master already fixes it, keep its severity: users run the release
until the next one ships. Note it in the candidate note as
`Already fixed on master in <PR number or short sha>`. Step 7 files it as
a private advisory, at any severity, because a PR has nothing left to
change.

Done when every candidate has a verdict and a master check.

## Step 7: Draft your reports (don't file them yet)

PRs are the default output of a scan. Draft one for anything low,
informational or hardening. Before you finish, consider at least one PR
candidate:

- a fix for a low finding;
- a test that pins a security property the tests don't cover yet
  (`CHECKS.md` Section 5);
- a file that belongs in `security/surface.txt` and `.github/CODEOWNERS`;
- a change to `CHECKS.md`, `VERIFY.md`, `REPORT.md` or this skill.

Draft it if it is real. A weak PR is closed and earns nothing, so don't
pad. A low finding or a merged hardening PR takes 2% of the bounty pool
(`SCANS.md` § Points). A finding's fix that merges adds 1%. The
maintainer decides what counts as hardening.

Draft each candidate that survived Step 6, at the severity its verdict
gives:

- **Low or informational, or a hardening change:** draft a PR.
- **Medium, high or critical:** draft a private advisory. If you're unsure
  whether it's low or medium, treat it as medium.
- **Already fixed on master** (Step 6): draft a private advisory at its
  severity, with the line `Already fixed on master in <ref>.` at the end
  of the Summary. Don't draft a fix PR for it.

Draft everything, and file nothing yet. Every PR and advisory, skill and
surface PRs included, quotes the round's attestation id, which you get
when the user signs. Write `{{ATTESTATION_ID}}` in its place. The id goes
in PR and advisory bodies, never in a commit message. The id credits the
wallet, not the round, so any id this wallet has signed works when the
round's own can't be signed.

Save every draft in the round folder, numbered from 1 within the round:
`.gleam-scan/rounds/<area>/pr-<n>.md` and
`.gleam-scan/rounds/<area>/advisory-<n>.md`. `pnpm scan` counts the
reports from these files.

Read `security/scan/REPORT.md` before you write the first draft. It gives
the shape and style of every advisory and PR body: a plain title and
summary a maintainer can skim, with everything else in a `<details>`
block.

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

The pre-commit hook runs gitleaks, eslint and tsc. If it fails, fix what
it names and commit again.

- Title: a Conventional Commit, `fix(security): <what it fixes>`
  (`docs(security): …` for a docs-only fix).
- Body: follow `.github/PULL_REQUEST_TEMPLATE.md` in the style of
  `REPORT.md` § PR body. Fill **Why** and **What**. The **Attestation id**
  section gets `Attestation id: {{ATTESTATION_ID}}`. Tick only the
  Checklist boxes you ran; leave the rest unticked and say why in the
  body. Save it as `.gleam-scan/rounds/<area>/pr-<n>.md` in the scan
  checkout.
- Low details may be public. Medium-and-above details never go in a PR,
  even one that fixes them.

**Advisory draft.** Start with a `Title:` line, written as `REPORT.md`
§ Advisory title gives it: who can do it and what the user loses, in the
user's words. Then write the description in the shape `REPORT.md` gives:
a plain **Summary** of about 100 words at reading grade 6 to 7, the
`Attestation id: {{ATTESTATION_ID}}` line, then `<details>` with
**Impact**, **Steps**, an optional **Fix** and the triager's evidence.
Write a fix for every finding you draft, if you can. For an advisory,
write it in a worktree as for a PR draft, run its tests, and put
`git diff origin/master` in **Fix** as a `diff` block. Never push it or
open a PR for it. A fix that merges earns a 1% bonus.

**Fix-bonus lines.** After a round's `pnpm scan finish` passes, write
one line per finding draft above its round offer, and nothing for a
hardening, skill or surface PR:

- with a fix: `<Advisory|PR> <n> includes a fix. If it merges, it earns a 1% fix bonus.`
- without one: `Advisory <n> has no fix yet. Reply "fix <n>" and I'll write one: a fix that merges earns a 1% bonus.`
Give the evidence from the verdict once: demonstrated, traced, or the
exact fact a browser check has to settle.
Save it as `.gleam-scan/rounds/<area>/advisory-<n>.md`. `pnpm scan
finish` warns when the part above `<details>` is too long or too hard to
read.

**Skill or surface PR.** This skill improves through the scans that use
it. If something would have made your scan better, draft a PR for it, in
its own worktree like a fix PR, and save its body as
`.gleam-scan/rounds/<area>/pr-<n>.md`. For example:

- a file that belongs in `security/surface.txt`. Add it at its tier, and
  add the same path to `.github/CODEOWNERS` (a test keeps the two
  identical);
- an area, check, search or tool that `CHECKS.md` should name;
- a reason to refute, or a severity example, that `VERIFY.md` should
  give;
- a command in this skill that failed or misled you, or a `✗` message
  that didn't say what to do;
- a test that failed because of the test code (Step 3). Fix the test,
  not the code under it, and title the PR `test(<scope>): <what it
  fixes>`.

Title any other one `docs(scan): <what it improves>`, and fill the
template's **Why** with what happened in your scan. Keep it general: a
skill PR never describes a vulnerability, not even a low one. If it comes
from a medium or higher finding (a surface entry alone points at the
bug), don't file it until the advisory is fixed. It doesn't change
`result`. A maintainer reviews it like any other PR, and nothing merges
automatically.

Done when you have considered at least one PR candidate, and every
surviving finding and real PR candidate has a draft in the round folder.
If nothing survived Step 6, that's a clean round.

## Step 8: Answer the challenge and finish the round

### 8a. Fill in `.gleam-scan/rounds/<area>/attestation.json`

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
- `result`: `"scanned"` if the round folder has an advisory draft, or a
  fix or hardening PR draft; otherwise `"pass"`. A skill, surface or
  test-fix PR doesn't count either way. It never says what you found, and
  both earn the same.
- `report`: markdown, at most 20,000 characters, `\n` line endings. It
  describes **coverage only**: the area this round covered, what you
  checked, what you didn't, the tools you ran and their outcome in
  general terms (from `.gleam-scan/setup.md`), how many candidates Step 6
  verified and whether subagents verified them, and how long the round
  took (from the `Started:` time `pnpm scan start` printed to `date -u`).
  Never vulnerability details, not even for a low finding. "Drafted 1 PR
  and 1 advisory" is fine. What they are about is not.

### 8b. Run `pnpm scan finish` until it passes

```bash
pnpm scan finish          # the current round; or: pnpm scan finish --area <area>
```

It checks the attestation locally, then asks the points server to run the
same checks. Each problem prints as one line, `✗ <field>: <what to
change>`. Fix each one in `.gleam-scan/rounds/<area>/attestation.json` and
run it again. On success it prints, sometimes after a `Replaced …` note:

```text
✓ Attestation valid for Gleam v<release>, area <label>.
Attestation id: <64 hex characters>
Paid places left: <n>

Show the user exactly this, as the last thing you write:

Round 2 (Signing) is ready. 2 rounds and 3 reports are waiting to be signed. Round 3 earns 14.88 points even with no findings, and nobody has examined 97 of the 137 functions in Trust boundary yet. Reply "next" to scan it, or "file" to sign and file everything.
```

When every area has a round in this checkout, the message offers only
"file":

```text
Round 5 (Build and release) is ready. Every area of v<release> is done in this checkout. Reply "file" to sign the 5 rounds and file 3 reports.
```

A line starting with `!` names a draft advisory whose title or summary
breaks `REPORT.md`. It never fails the run. Fix the draft; you don't need
to run `finish` again.

`finish` rewrites the attestation with `release` and `commit` filled in.
You can run it again at any time, for example after you edit the report.
It doesn't use up the challenge.

End your turn with the round offer, as Closing messages says. Write
nothing above it but a `Warning:` line `finish` printed, the fix-bonus
lines (Step 7), or the new-session line (Subagents).

## Replies

After a closing message, the user's reply decides the turn. Each row
ends the turn with the closing message of the last command it names.

| The user replies | Do |
| --- | --- |
| "next", or names an area to scan | Run `pnpm scan start` (with `--area <id>` if they named one), then the round as How a session runs says, through `pnpm scan finish`. End with its round offer. |
| "file", or declines another round ("no", "stop", "done") while rounds wait | Run `pnpm scan file`. End with its sign request. |
| "fix <n>" | Write the fix for advisory `<n>` of the latest round as Step 7 says, and add it to that draft's **Fix**. Then re-run `pnpm scan finish --area <area>` for that round, and end with its message, with the fix-bonus lines above it. |
| "signed" | Run `pnpm scan next`. File the reports of each round it lists as signed (File the reports). Then run `pnpm scan next` again, and end with its closing message: the round offer, the sign request for rounds still unsigned, or every area done. Above it, one line per filed link. |
| Anything else | Answer in one to three lines. Then re-run the command that printed the last closing message you showed (`pnpm scan finish`, `pnpm scan file`, `pnpm scan next`, or `pnpm scan start`), and end with its message. |

If the user writes while a round is in progress (after its `pnpm scan
start`, before its `pnpm scan finish` passes), answer in a line or two
and carry on with the round. The turn ends with that round's offer.

**`pnpm scan file`** re-checks every round that waits to be signed, then
prints one line per round with its attestation id and round folder, and
the sign request:

```text
3 rounds are ready to sign, with 4 reports to file.

1. Open this link and sign each round in Gleam: https://gleamwallet.app/attest.html#<payload>.<payload>.<payload>
2. Reply "signed" and I'll file the reports.
```

For rounds with no reports, line 2 is `2. Reply "signed" when you're
done.` The link signs the rounds in order, one approval each in Gleam. It
works until the first round's challenge expires, 72 hours after its
`pnpm scan start`.

**`pnpm scan next`** asks the server which waiting rounds the user
signed. It prints one line per round: `Round <n> (<label>) is signed:
<points> points. Attestation id <id>; drafts in <folder>/.`, or `<label>:
not signed yet`. Once every round is signed, it ends with the next round
offer:

```text
Signed: 3 rounds earned 38.12 points. Round 4 earns 14.88 points even with no findings, and nobody has examined 40 of the 60 functions in Build and release yet. Reply "next" to scan it.
```

With no area left it says `This wallet has scanned every area of
v<release>; the next release opens new rounds.` That is the last offer;
on any later reply, answer and end with `pnpm scan next`'s message again.

`next` checks each round that is still unsigned again, as `file` does:

- A round that can still be signed: `next` prints `✗ unsigned: …` and the
  sign request for those rounds only.
- A round that can't be signed any more (its challenge expired, say):
  `next` prints a `✗ <area> challenge: …` line naming the `pnpm scan start
  --area <area>` and `pnpm scan finish --area <area>` that answer it
  again, and no closing message. Do what it says, then run `pnpm scan
  next` again. Its sign request then covers that round and the other
  unsigned ones. This is not an unanswered sign request.

Running `pnpm scan next` again at any time is safe: it prints the same
closing message until something changes.

### If the user doesn't sign

A sign request goes unanswered when the user replies to it with anything
but "signed", or replies "signed" and `pnpm scan next` prints `✗
unsigned: …`. Each time, first add 1 to the count on disk:

```bash
echo $(( $(cat .gleam-scan/declines 2>/dev/null || echo 0) + 1 )) > .gleam-scan/declines
```

`pnpm scan file` and `pnpm scan next` print the count above the sign
request as `Unanswered sign requests so far: <n> (.gleam-scan/declines).`
`next` deletes the file once the user signs a round. Then, by that count:

- **1 or 2:** answer in a line or two, and say that reports filed without
  the attestation id earn no award. Run `pnpm scan file` (`pnpm scan
  next` after a "signed") and end with its sign request.
- **3 or more, or the user says to file anyway:** file every draft of the
  unsigned rounds that their `filed.txt` doesn't list yet (File the
  reports). Replace `{{ATTESTATION_ID}}` with the id of any round this
  wallet has signed, from a `signed.json` in `.gleam-scan/`, since any
  signed id credits the wallet. With none, write `none (not signed)`,
  so the line reads `Attestation id: none (not signed)`. Then run `pnpm
  scan file` and end with its sign request, with one line per filed link
  above it. Its line 2 now offers to add the ids.

If the user replies "signed" later, the "signed" row of Replies applies.
File the reports says how to add the id to a report filed without it.

If no unsigned round has a report, there is nothing to file: keep
answering, re-running `pnpm scan file` and ending with its sign request.

### If a command keeps failing

Do what each `✗` line says and run the command again. If the same command
fails twice in a row with a network, rate-limit or server error, tell the
user in one line what failed. Then end with the last closing message you
showed in this conversation, word for word. If you have shown none, stop
after that line.

## File the reports

The user's "signed" is the approval to fork, push, open each PR and file
each advisory of the rounds `pnpm scan next` lists as signed. Don't ask
again. For each such round:

1. In each `pr-*.md` and `advisory-*.md` in its round folder that its
   `filed.txt` doesn't list, replace `{{ATTESTATION_ID}}` with the
   round's attestation id from `next`. Only a skill PR that Step 7 says
   to hold for an unfixed advisory waits.
2. File it, as below.
3. Append a line to the round folder's `filed.txt`: the draft's file name,
   a space, then its link, such as `pr-1.md
   https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/pull/12`.
   For a draft you hand to the user instead, write `handed-over` in place
   of the link.
4. Each draft that `filed.txt` listed before this step was filed without
   the id (If the user doesn't sign). Unless its line in `filed.txt`
   already ends with `id-added`:
   - In the draft, replace the line `Attestation id: none (not signed)`
     with `Attestation id: <id>`.
   - For a PR, update its body: `gh pr edit <PR number from its link>
     --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet --body-file
     .gleam-scan/rounds/<area>/pr-<n>.md`.
   - For an advisory, post a comment on it with the line
     `Attestation id: <id>`. If you can't, give the user that line to
     post, above the closing message.
   - Append ` id-added` to its line in `filed.txt`.

Don't edit a round's `attestation.json` after the user signs it.

**File a PR** (needs `gh` signed in to the user's GitHub account). If the
user can push to the repository, skip the fork: `git push origin HEAD` and
pass `--head fix/security-<short-name>`.

```bash
cd ../gleam-fix-<short-name>
gh repo fork --remote --remote-name fork      # forks origin, adds the fork as remote "fork"
git push fork HEAD
gh pr create --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet --base master \
  --head <your-github-login>:fix/security-<short-name> --title "fix(security): <what it fixes>" \
  --body-file ../gleam-scan/.gleam-scan/rounds/<area>/pr-<n>.md
```

In the body, the template's `## Attestation id` section holds the line
`Attestation id: <id>`.

**File a private advisory** (the private vulnerability report from
`SECURITY.md`): open
https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security/advisories/new,
or with `gh`:

```bash
gh api repos/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security-advisories/reports \
  -f summary="$(sed -n '1s/^Title: *//p' .gleam-scan/rounds/<area>/advisory-<n>.md)" \
  -f severity="<low|medium|high|critical>" \
  -f description="$(sed 1d .gleam-scan/rounds/<area>/advisory-<n>.md)"
```

The title comes from the draft's `Title:` line, and the description is
everything under it, including the line `Attestation id: <id>`.

If you can't file (no `gh`, or the user would rather do it), give the user
each draft above the closing message, ready to paste, with the id already
in it. Never publish an advisory's text anywhere else.

## Subagents

If your agent can start a subagent with a fresh context, you coordinate
and the subagents read the code. Keep in your own context only the round
list (area, round folder, attestation id), the candidate verdicts and the
draft paths. Everything else is in the round folder.

For each round, after Step 1:

1. **Round subagent.** Start one fresh subagent with only this prompt,
   filled in:

   > In the Gleam checkout at <absolute checkout path>, follow § Round brief in security/scan/SKILL.md for the round folder .gleam-scan/rounds/<area>. Use the model id <your model id> in the attestation.

   Wait for its summary block.
2. **Verify.** For each candidate in the summary, start a fresh verifier
   as Step 6 says. Act on the verdicts as Step 6's table says, then do
   Step 6's master check yourself.
3. **Draft.** For each candidate that survived, pick its file name: a
   verdict severity of low or informational gets `pr-<n>.md`, medium and
   above, or a finding master already fixes, `advisory-<n>.md`. Number from 1 above the highest number of that
   kind already in the round folder or given to another draft subagent,
   so no two drafts share a name. Then start a fresh subagent with only
   this prompt, filled in:

   > In the Gleam checkout at <absolute checkout path>, follow § Draft brief in security/scan/SKILL.md for the candidate .gleam-scan/rounds/<area>/candidates/<n>.md, with this verdict: <the verdict block>. Save the draft as .gleam-scan/rounds/<area>/<file name>.

   You can run several at once. Each returns one line.
4. **Finish.** Set `result` in the round's attestation (Step 8a) from the
   PR types and advisories the subagents returned, and add one line to
   `report` saying how many candidates fresh subagents verified. Run
   `pnpm scan finish` (Step 8b) and end the turn with its round offer.

If a subagent fails or returns nothing usable, do its part yourself.

**Without subagents**, do every step yourself. The round folders hold
everything, so the user can continue in a new session. From the second
round on, put this line above every round offer from `pnpm scan finish`,
with the path filled in:

```text
To continue in a new session, paste this, then your reply: Continue the Gleam scan in <absolute checkout path> by following security/scan/SKILL.md. My reply:
```

## Round brief

You review one area of a Gleam release, as one round of a scan another
agent coordinates. You get the checkout path, the round folder
(`.gleam-scan/rounds/<area>`, called the round folder below) and a model
id.

1. `cd` into the checkout. Read § Rules that always apply. Its last rule,
   § Closing messages and § Replies are for the coordinating agent, not
   you: you end with the block in step 7 and nothing else. Don't run any
   `pnpm scan` command, move `HEAD`, commit, push or file anything.
2. Read `.gleam-scan/setup.md`, the round folder's `area-files.txt`, and
   the 3 functions in its `challenge.json`.
3. Follow Steps 2, 4 and 5 of this skill. Leads go in the round folder's
   `leads.md`.
4. Follow the first paragraph of Step 6: write the candidate notes in the
   round folder's `candidates/`. Don't verify them.
5. Follow Step 7 for PR candidates that come from no finding: a test that
   pins a security property, a surface entry, a skill change, a test fix.
   Save each body as `pr-<n>.md` in the round folder. Don't draft the
   candidates.
6. Follow Step 8a for the round folder's `attestation.json`: `answers`,
   `model` (the id you were given) and `report`. Leave `result` as it is.
7. Return only this block, at most 10 lines, with no vulnerability
   details:

   ```text
   Round: <area>
   Reviewed: <n> of <m> area files; not reached: <files, or none>
   Candidates: <candidates/1.md, candidates/2.md, …, or none>
   PR drafts: <pr-1.md (hardening|surface|skill|test fix), …, or none>
   Attestation: answers, model and report filled
   Problems: <one line, or none>
   ```

## Draft brief

You draft the report for one verified candidate of a Gleam scan. You get
the checkout path, the candidate note's path, its verdict block and the
file name to save the draft as.

1. `cd` into the checkout. Read § Rules that always apply. Its last rule,
   § Closing messages and § Replies are for the coordinating agent, not
   you: you end with the line in step 4 and nothing else. Don't run any
   `pnpm scan` command, move the checkout's `HEAD`, push or file anything.
2. Apply the verdict as Step 6's table says.
3. Read `security/scan/REPORT.md`, then follow Step 7 for this candidate
   at the verdict's severity: a PR (with its fix in a worktree) for low
   or informational, an advisory for medium and above. Save it under the
   file name you were given, and no other.
4. Return only one line: `<file name> (fix|hardening|advisory
   <severity>)`, plus `; worktree <path>` for a PR.

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
- Write every advisory and PR body as `REPORT.md` says: short on top,
  detail in `<details>`.
- A clean `pass` earns the same as `scanned`. Padding a report with weak
  findings earns nothing.

Never use a seed phrase, a real key, a real wallet, or real funds.

## Example attestation

A filled-in attestation for a clean round, after `pnpm scan finish`
filled `release` and `commit`. The challenge id, commit and line numbers
are illustrative; use the ones from your own challenge and checkout.

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
      "file": "packages/core/src/policy/signing-origin.ts",
      "symbol": "isSecureSigningOrigin",
      "line": 9,
      "check": "Allows plain http only on loopback hosts, so a page a network attacker can inject into can't ask for a signature."
    },
    {
      "file": "packages/runtime/src/handlers/provider-params.ts",
      "symbol": "readAtomicAmount",
      "line": 170,
      "check": "Rejects a transaction amount that isn't a whole number of Winston before it reaches signing."
    }
  ],
  "result": "pass",
  "report": "## Coverage\n\nArea: Trust boundary (tier 3).\n\n- Read docs/THREAT_MODEL.md in full.\n- Ran `pnpm vitest run`: all tests passed.\n- Ran `osv-scanner scan --config osv-scanner.toml --lockfile pnpm-lock.yaml`: no advisories that Gleam's code reaches.\n- Reviewed the 6 area files changed since v1.25.0 line by line.\n- Reviewed the rest of the area (background, content, provider, sender, dispatch).\n- Followed the provider's signing calls into tier 2 (signing pipelines).\n\n## Not covered\n\n- Tiers 1, 4 and 5 beyond those calls.\n- Nothing run in a real browser.\n\nNo candidates. Drafted nothing. About 2 hours.",
  "release": "1.26.0",
  "commit": "84f6449691277f9af52fd0be17957541e02cd8d9"
}
```

For a round that drafted a PR and an advisory, `result` is `"scanned"`
and the report says, for example, "Drafted 1 PR and 1 private advisory",
with nothing about what they contain.

## Troubleshooting

Each `✗` line already says what to do. The common ones:

| You see | Do |
| --- | --- |
| `✗ network: Couldn't reach …` | Check the connection, then run the command again. |
| `✗ rate_limited: … wait N seconds …` | Wait that long, then run it again. |
| `✗ http_404: … has no /scan/… endpoint …` | Community scans aren't live on that server. Tell the user; if they set `GLEAM_POINTS_API`, check it. |
| `✗ http_5xx: The points API had a server error …` | Wait a few minutes, then run it again. |
| `✗ http_<code>: … with no explanation …` | Stop and tell the user; it's a bug to report. |
| `✗ $: Gleam couldn't read the release from GitHub …` | Wait a minute, then run it again. |
| `✗ release: Gleam hasn't published a release yet …` | Nothing to scan yet. Tell the user. |
| `✗ area: … isn't a scan area …` | Use one of the ids it lists, or leave out `--area`. |
| `✗ area: The <label> round passed \`pnpm scan finish\` and waits to be signed …` or `… is signed in this checkout …` (start) | Run `pnpm scan start` without `--area`. |
| `✗ area: Every area of v<x> is scanned in this checkout …` (start) | End the turn with the closing message it printed. |
| `✗ round: The <label> round is open in … ; finish it …` (start) | Finish that round as Resumed session says, through the `pnpm scan finish --area <id>` it names. Then act on the reply. |
| `✗ $: v<x> has fewer than 3 security functions …` | The challenge pool is broken. Tell the user. |
| `✗ git: HEAD is … but the latest release is v<x> …` (start) | Run the `git fetch --tags && git checkout v<x> && pnpm install --frozen-lockfile` it prints, then the `pnpm scan start` it names. |
| `✗ git: … has no v<x.y.z> release tag` or `✗ commit: HEAD is … but the challenge is for …` | Your `HEAD` moved off the tag. Run `git checkout v<release>` in the scan checkout, then the command again. |
| `✗ <file>: \`<symbol>\` isn't in <file> at <sha> …` (start) | Run `git fetch --tags` and `pnpm scan start` again; if it repeats, tell the user. |
| `✗ round: There is no round yet …` | Run `pnpm scan start` from the checkout root. |
| `✗ …/attestation.json: … isn't valid JSON at line L, column C …` | Fix the JSON syntax there. |
| `✗ model: …` | Set `model` to your model id: printable ASCII, 1 to 64 characters. |
| `✗ report: …` | Write the coverage report; `\n` line endings, no control characters. |
| `✗ result: …` | Set it to `"pass"` or `"scanned"`. |
| `✗ <key>: <key> isn't part of the attestation format …` | Remove that key. |
| `✗ answers[i].line: … is 0 …`, `… is a comment`, `… is blank`, `… holds only punctuation`, `… is in the signature …`, `… is outside …`, `… closes …` | Pick another line inside the body range the message gives, one that makes a check. Count lines with `git show HEAD:<file> \| cat -n`. |
| `✗ answers[i].check: …` | One sentence, 10 to 300 characters, one line, no leading or trailing space. |
| `✗ answers[i].symbol: …` or `✗ answers[i]: … isn't in the challenge …` or `✗ answers: No answer names …` | Restore `file` and `symbol` exactly as `pnpm scan start` wrote them; one answer per challenge function. |
| `✗ challenge: …` (finish) or `✗ <area> challenge: …` (file, next) that names `pnpm scan start --area <area>`: the challenge expired, was already used, is unknown or was issued for another commit | Run the `pnpm scan start --area <area>` it names, answer the 3 new functions in that round's `attestation.json`, copy `model`, `result` and `report` from the backup `attestation.<old challenge id>.json` in the round folder, run the `pnpm scan finish --area <area>` it names, then the command you were running. The round's drafts stay as they are. |
| `✗ release: v<x> isn't the latest release (v<y> is) …` | A new release came out. Run `git fetch --tags && git checkout v<y> && pnpm install --frozen-lockfile`, then `pnpm scan start`. It moves the old release's rounds to `.gleam-scan/v<x>/`; they can't be signed. Scan the new release from Step 1. |
| `✗ attestationId: The server computed a different attestation id …` | Your checkout's scan tools are out of date. Run `git fetch --tags`, check out the latest release again, and run the command again. |
| `✗ rounds: No round has passed \`pnpm scan finish\` yet …` (file) | Finish the round (Step 8), then run `pnpm scan file`. |
| `✗ rounds: Every round in this checkout is signed …` (file) | Run `pnpm scan next`. |
| `✗ rounds: No round is waiting to be signed …` (next) | Run `pnpm scan file`. |
| `✗ unsigned: …` (next) | File the drafts of the rounds `next` lists as signed, and end with the sign request it printed. |
| `✗ scan: Unexpected error …` | Run it again; if it repeats, tell the user. |

If the user reports an error from the signing page:

- "isn't registered for Gleam Points": they register the wallet in Gleam
  → Points, then open the same link again.
- "hasn't checked in during the last 3 days": they open Gleam, then open
  the same link again.
- "expired" or "already used": run `pnpm scan file`. Its `✗` line names
  the round to answer again.
- "already scanned the <label> area": this wallet scanned that area
  elsewhere. Move that round's `pr-*.md` and `advisory-*.md` into another
  waiting round's folder under free numbers, delete its folder
  (`rm -r .gleam-scan/rounds/<area>`), and run `pnpm scan file`.
- "has scanned every area": this wallet has scanned the whole release.
  Another registered wallet can sign the link.

In each case, end the turn with the sign request of the last `pnpm scan
file` you ran.
