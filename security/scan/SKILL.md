---
name: gleam-scan
description: Scan the latest Gleam wallet release for security issues, report what you find the right way (PR or private advisory), and produce a signed-by-the-user attestation that earns the user Gleam Points. Use when asked to scan, audit or security-review a Gleam release.
---

# Scan a Gleam release

The line a user pastes into their agent to start this skill:

> Scan the latest Gleam release for security issues by following security/scan/SKILL.md in https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet.

Gleam is a Chrome browser-extension wallet for Arweave and AO. In this
skill you check out its latest release, review the code where a bug could
leak a key or sign something the user didn't approve, report what you find,
and answer a short challenge that shows you read the code. At the end you
give the user a link. They open it, Gleam shows them the attestation, and
when they approve, their Gleam wallet signs it and earns Gleam Points. You
never sign anything, hold a key or touch a wallet. The user does that in
Gleam. The user needs a Gleam wallet that is registered for points, and the
wallet that signs gets the points.

Follow the steps in order. Every command runs from the root of the checkout
unless a step says otherwise. Background on the program is in `SCANS.md`.

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
  fails if `HEAD` moves. Write any fix in a separate worktree (Step 6).
- When a `pnpm scan` command prints a line starting with `✗`, do what that
  line says, then run the command again.

## Prerequisites

You need Node 22 or later, git, and pnpm through corepack:

```bash
node --version                 # v22.x or later
corepack enable                # provides the pnpm version pinned in package.json
```

Clone the repository and fetch its tags:

```bash
git clone https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet.git gleam-scan
cd gleam-scan
git fetch --tags
```

Find the latest release. "Latest" means the release GitHub marks as
**Latest** (not a draft, not a pre-release), which is what the points
server uses. A git tag alone isn't a release.

```bash
gh release view --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet --json tagName -q .tagName
# without gh:
curl -s https://api.github.com/repos/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/latest | grep '"tag_name"'
```

Either prints a tag such as `v1.26.0`. Check it out and install:

```bash
git checkout v1.26.0           # the tag you found
pnpm install --frozen-lockfile
```

If you can't reach GitHub's API, skip this and run Step 1 from any
checkout: if `HEAD` isn't the latest release, `pnpm scan start` prints the
exact `git checkout` command to run.

After the checkout, read `security/scan/SKILL.md` from the checkout. If it
differs from the copy you started with, follow the checkout's copy.

Install `osv-scanner` (used in Step 3): `brew install osv-scanner`, or
`go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`, or a
binary from https://github.com/google/osv-scanner/releases. If you can't
install it, use `pnpm audit` instead in Step 3 and say in the report that
osv-scanner wasn't run.

Note the time you start (`date -u`). The report says how long you spent.

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
  Step 7.

The challenge expires after 24 hours and can be used once. Run `start` only
once. Running it again replaces the challenge with new functions (it backs
up your old attestation to `.gleam-scan/attestation.<old id>.json`).

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
  closed. It is a finding only if you show what its *Still a finding if*
  clause names.
- **Known limitations**: already known. Not findings.

Where the docs and the code disagree, the code is right. A docs mismatch
is a low finding: fix the docs in a PR (Step 6).

Done when you can name the attackers and the By design entries.

## Step 3: Run the tests and the dependency scan

```bash
pnpm vitest run
osv-scanner scan --config osv-scanner.toml --lockfile pnpm-lock.yaml   # or, if unavailable: pnpm audit
```

The tests take a few minutes. Done when both have finished and you have
noted the results. A test failure
is not a finding by itself; note it in the report. A vulnerable dependency
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

Review the changed files first, in tier order (1 before 5). Then review the
rest of the surface, again in tier order. List it all with:

```bash
git ls-files -- $(awk '!/^#/ && NF == 2 { print $2 }' security/surface.txt)
```
Read the 3 challenge functions closely on the way, since you answer for
them in Step 7.

What to look for in each area:

- **Key material** (`core/signer/`, `core/vault/`, `handlers/key-session.ts`,
  `src/keyring/`, `entrypoints/keyring/`, `adapters/offscreen-keyring.ts`):
  where the decrypted key lives while unlocked, and whether it ever
  reaches `chrome.storage.local`, a message to a page or a log. Whether
  byte buffers are zeroed after use and on every error path (`zeroize.ts`);
  a JS string can't be zeroed, so a key held as a string is worth noting.
  Which contexts the offscreen keyring accepts a port from, and what it
  checks before it answers.
- **Locking** (`handlers/key-session.ts`, `enforceAutoLock`): whether the
  auto-lock alarm really removes the keys, and what happens when the
  service worker or the offscreen document restarts mid-session: does
  the wallet come back unlocked when it should be locked?
- **Provider bridge** (`entrypoints/provider/`, `entrypoints/content/`,
  `packages/messaging/src/page-protocol.ts`): the `event.source` check,
  per-request ids, the `settled` flag, timeouts, and decoding of binary
  values. Whether every page-supplied value has a size limit before it is
  parsed, stored or shown.
- **Dispatch** (`src/dispatch/methods.ts`, `src/sender.ts`,
  `handlers/provider-params.ts`): each method's caller tier, whether it can
  open an approval, and whether its zod schema accepts anything the handler
  doesn't expect. Whether any method that signs or reveals something can
  run without an approval.
- **Permissions** (`wxt.config.ts`): `optional_host_permissions` is
  `https://*/*`, so check that every runtime host request asks for exactly
  the host the user typed, shows it, and validates it
  (`popup/network-peers/`). Check what each `web_accessible_resources`
  entry lets a page load or learn.
- **CSP** (`src/csp.ts`): what `wasm-unsafe-eval` allows, whether any
  directive is missing, and whether the looser dev policy can reach a
  production build.
- **Crypto** (`core/signer/envelope.ts`, `core/arweave/rsa-pss.ts`): the
  Argon2id parameters and their bounds, whether a stored envelope can force
  weaker parameters, and whether there is any fallback to a weaker KDF.
  Correct AES-GCM nonce handling and RSA-PSS salt length.

Done when you have read every changed surface file and as much of the rest
as you can, and you know which files you didn't reach.

## Step 5: Look anywhere else that seems worth it

The surface list and Step 4's checklist are where to start, not the
limit. Follow data and calls out of the surface wherever they lead:
callers, message handlers, the build config, anything you suspect. A
finding outside the surface counts the same as one inside it.

To find leads quickly, search the whole repository (not only the surface)
for these, and check each hit that handles key material or page input:

```bash
git grep -nE 'crypto\.subtle|exportKey|importKey|storage\.local|storage\.session|postMessage|innerHTML|insertAdjacentHTML|data:|downloads\.' -- '*.ts' '*.tsx' '*.js' '*.mjs' ':!*.test.ts' ':!*.test.tsx'
```

It prints about 200 lines, so skip the ones you have already read.

To show that a suspected bug is real, write a throwaway unit test, for
example one that feeds a malformed or oversized binary value to the
decoder in `page-protocol.ts`, and run it with `pnpm vitest run
<path-fragment>`. A failing test turns "suspected" into "demonstrated".
Delete the test afterwards, or put it in your fix PR. Never test against
a real wallet.

If a file you reviewed here can leak a key, sign something unapproved or
let a page past the wallet's boundary, it belongs on the surface. Note it
for the surface PR in Step 6.

Done when you have followed the leads you found.

## Step 6: Draft your reports (don't file them yet)

Decide the severity of each finding with the calibration rules below. Then:

- **Low or informational, or a hardening change:** draft a PR.
- **Medium, high or critical:** draft a private advisory. If you're unsure
  whether it's low or medium, treat it as medium.

Draft everything first, and file nothing yet. A PR or advisory has to
quote the attestation id, and the id only exists once Step 7 passes.

**PR draft.** Write the fix in a separate worktree off `master`, so the scan
checkout stays on the tag:

```bash
git fetch origin master
git worktree add -b fix/security-<short-name> ../gleam-fix-<short-name> origin/master
cd ../gleam-fix-<short-name>
# make the change, add or update a test, then:
pnpm vitest run <path-fragment>
git commit -am "fix(security): <what the change does>"
```

- Title: a Conventional Commit, `fix(security): <what it fixes>`
  (`docs(security): …` for a docs-only fix).
- Body: follow `.github/PULL_REQUEST_TEMPLATE.md`. Fill **Why** and
  **What**. The **Attestation id** section gets the id in Step 7.
- Low details may be public. Medium-and-above details never go in a PR,
  even one that fixes them.

**Advisory draft.** Write a title, the severity, and a description with:
the attacker (from the threat model), the affected files or flow, the steps
from the attacker's access to the harm, whether you demonstrated it or
suspect it, and the impact. Keep the draft local, for example in
`.gleam-scan/advisory-1.md` (`.gleam-scan/` is ignored by git).

**Skill or surface PR.** This skill improves through the scans that use
it. If something would have made your scan better, draft a PR for it, in
its own worktree off `master` like a fix PR. For example:

- a file that belongs in `security/surface.txt`. Add it at its tier, and
  add the same path to `.github/CODEOWNERS` (a test keeps the two
  identical);
- an area, check, search or tool that Step 4 or Step 5 should name;
- a command in this skill that failed or misled you, or a `✗` message
  that didn't say what to do.

Title it `docs(scan): <what it improves>`, and fill the template's **Why**
with what happened in your scan. Keep it general: a skill PR never
describes a vulnerability, not even a low one. It doesn't change
`result`. A maintainer reviews it like any other PR, and nothing merges
automatically.

Done when every finding and skill suggestion has a draft. If you have no
findings, that's a clean scan.

## Step 7: Answer the challenge, finish, then file

### 7a. Fill in `.gleam-scan/attestation.json`

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
    check, such as an `if (...)`, a `throw`, or a `return` that rejects.
    Line numbers are those of the file at the release commit. Get them
    with:

    ```bash
    git show HEAD:<file> | cat -n | sed -n '<start>,<end>p'
    ```

    using the `lines <start>-<end>` that `pnpm scan start` printed.
  - `check`: one sentence, 10 to 300 characters, on one line, on what that
    check prevents. Write it from what you read, about this code.
- `result`: `"pass"` if you drafted no fix PR or advisory in Step 6,
  `"scanned"` if you drafted at least one. A skill or surface PR doesn't
  count either way. It never says what you found, and
  both earn the same.
- `report`: markdown, at most 20,000 characters, `\n` line endings. It
  describes **coverage only**: what you checked, what you didn't, the tools
  you ran and their outcome in general terms, and how long you spent. Never
  vulnerability details, not even for a low finding. "Filed 1 PR and 1
  advisory" is fine. What they are about is not.

### 7b. Run `pnpm scan finish` until it passes

```bash
pnpm scan finish          # or: pnpm scan finish --json
```

It checks the attestation locally, then asks the points server to run the
same checks. Each problem prints as one line, `✗ <field>: <what to
change>`. Fix each one in `.gleam-scan/attestation.json` and run it again.
On success it prints:

```text
✓ Attestation valid for Gleam v<release>.
Attestation id: <64 hex characters>
Paid places left: <n>
Put the attestation id <id> in every PR and advisory you filed for this scan.
Link: https://gleamwallet.app/attest.html#<payload>
Tell the user: Open this link in Chrome with Gleam installed and click Sign with Gleam; it signs no transaction and moves no funds.
```

`finish` rewrites `.gleam-scan/attestation.json` with `release` and
`commit` filled in. That doesn't change the id. You can run it again; the id
stays the same while the content does.

### 7c. File the drafts, quoting the id

The attestation id is the SHA-256 of the attestation's content, so it
changes if any field changes. In this order:

1. Finish the attestation and run `pnpm scan finish` until it passes.
2. Copy the `Attestation id`.
3. File every draft from Step 6, each with this line:
   `Attestation id: <the 64 hex characters>`
4. Don't edit `.gleam-scan/attestation.json` after that.

If you must change the attestation afterwards (for example the challenge
expired and you ran `pnpm scan start` again), run `pnpm scan finish`
again, take the new id, and update every PR and advisory you filed to
quote it. Then give the user the new link.

**File a PR** (needs `gh` signed in to the user's GitHub account; ask the
user first):

```bash
cd ../gleam-fix-<short-name>
gh repo fork --remote --remote-name fork      # forks origin, adds the fork as remote "fork"
git push fork HEAD
gh pr create --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet --base master \
  --title "fix(security): <what it fixes>" --body-file <your filled-in template>
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

Done when `pnpm scan finish` passes and every draft is filed, or handed to
the user, with the id in it.

## Report like a working security engineer

- Name a realistic attacker from the threat model, and show the concrete
  steps from the attacker's access to the harm. An attack that needs a
  compromised OS, malware, or the user's password is out of scope.
- Rate severity by what is likely, not the worst case you can imagine.
- Missing defence in depth is not a finding unless it enables a real
  attack.
- Say once whether a finding was demonstrated or is suspected, then write
  plainly.
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
  "report": "## Coverage\n\n- Read docs/THREAT_MODEL.md in full.\n- Ran `pnpm vitest run`: all tests passed.\n- Ran `osv-scanner scan source -L pnpm-lock.yaml`: no advisories that Gleam's code reaches.\n- Reviewed the 6 surface files changed since v1.25.0 line by line, tiers 1-3 first.\n- Reviewed the rest of tiers 1-3 (vault, keys, key session, background, content, provider, sender).\n- Skimmed tier 4 (approval window) and tier 5 (wxt.config.ts, CI workflows).\n\n## Not covered\n\n- Tier 5 release scripts and pnpm-lock.yaml beyond osv-scanner.\n- The popup screens outside the surface.\n- Nothing run in a real browser.\n\nFiled nothing. About 2 hours.",
  "release": "1.26.0",
  "commit": "84f6449691277f9af52fd0be17957541e02cd8d9"
}
```

For a scan that filed a PR and an advisory, `result` is `"scanned"` and the
report says, for example, "Filed 1 PR and 1 private advisory", with
nothing about what they contain.

## When you're done

Give the user the `Link:` that `pnpm scan finish` printed and the sentence
after `Tell the user:`:

> Open this link in Chrome with Gleam installed and click Sign with Gleam;
> it signs no transaction and moves no funds.

Also tell them the attestation id, which PRs and advisories you filed (or
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
| `✗ git: HEAD is … but the latest release is v<x> …` (start) | Run the `git fetch --tags && git checkout v<x>` it prints, then `pnpm scan start`. |
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
| `✗ challenge: The challenge expired …` or `This challenge expired` / `was already used` / `id is unknown` / `was issued for …` | Run `pnpm scan start`, answer the 3 new functions, keep your `model`, `result` and `report`, and run `pnpm scan finish`. The id changes: update anything you filed. |
| `✗ release: v<x> isn't the latest release (v<y> is) …` | A new release came out. Check out `v<y>`, run `pnpm scan start` and scan that release. |
| `✗ attestationId: The server computed a different attestation id …` | Your checkout's scan tools are out of date. Run `git fetch --tags`, check out the latest release again, and rerun `pnpm scan finish`. |
| `✗ scan: Unexpected error …` | Run it again; if it repeats, tell the user. |

If the user reports an error after opening the link: "isn't registered for
Gleam Points" means they register the wallet in Gleam → Points and sign
again; "hasn't checked in during the last 3 days" means they open Gleam,
then sign again; "already attested" means this wallet already attested this
release, and another wallet or the next release is needed.
