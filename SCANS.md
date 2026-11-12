# Community release scans

Anyone can point an AI agent at a Gleam release, scan it for security
issues, and earn Gleam Points. Each scan leaves a public, signed
attestation, and the extension shows the attestations for the version
installed.

Community scans add to the maintainers' pre-tag audit. They are not a
professional audit.

## How it works

1. **Hand the page to your agent.** `gleamwallet.app/scan.html` has
   a prompt to copy into your coding agent. It names the skill and every
   side effect up front, so the agent can check the skill against it
   before running anything:

   > Scan the latest Gleam release for security issues by following security/scan/SKILL.md in https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet. The skill clones the repo, installs its pnpm dependencies (which add a lefthook git hook to the checkout), runs its tests and osv-scanner, and calls the Gleam Points API at api.gleamwallet.app. It never needs a seed phrase, a real key, a wallet or funds. Ask me before any gh action: forking, pushing, opening a PR or filing an advisory.
2. **The agent scans one area per round.** It checks out the latest
   release tag and runs `pnpm scan start`, which picks the least-covered
   area with no round in that checkout, or `pnpm scan start --area <id>`
   when you name an area. That fetches a challenge for the area and
   writes the round folder, `.gleam-scan/rounds/<area>/`: the challenge,
   the area's files and a starter attestation. It prints the area, its
   files and the 3 functions to answer. Then the agent follows
   `security/scan/SKILL.md` from that checkout, reviewing the area's
   files first. Where it can start a subagent, each round's review runs
   in a fresh one.
3. **The agent reports what it finds.** PRs are the default: low or
   informational issues, hardening, and fixes to the skill. Medium and
   above go in a private GitHub advisory. Each report has a short summary
   on top and its detail folded under `<details>`
   ([`REPORT.md`](security/scan/REPORT.md)).
4. **The agent checks its own work.** `pnpm scan finish` reads the
   round's attestation, fills `release` and `commit` from git, runs the
   core checks locally, then sends the attestation to
   `POST /attestations/check`, which runs every server check that doesn't
   need your signature. Each failure prints one line,
   `✗ <field>: <what to change>`, and the agent fixes it before you see
   anything. A draft advisory that runs long or reads hard gets a `!`
   warning, which never fails the run. `--json` prints the same result as
   one JSON object.
5. **The agent offers another round.** On success `finish` prints the
   round offer, which the agent shows you as the last thing it writes:
   how many rounds and reports wait to be signed, what the next round
   earns even with no findings, and the least-covered area left. Reply
   "next", and the agent scans that area in the same checkout, skipping
   the setup it already did. Reply "file" to stop.
6. **You sign once.** On "file", `pnpm scan file` re-checks every waiting
   round and prints one `attest.html` link for all of them. Open it.
   Gleam shows a window with the release, the model, the result and the
   report of each round in turn. Approve each one, and the extension
   submits it. The agent never touches a key. Reply "signed".
7. **The agent files and offers more.** `pnpm scan next` asks the server
   which rounds you signed. The agent files the PRs and advisories of
   those rounds with their attestation ids and lists the links, then
   ends with the next round offer, or with the sign request again for a
   round still unsigned.
8. **You get points straight away.** The window shows "+N points" per
   round. Finding points arrive when a maintainer accepts the finding.

You need a Gleam wallet registered for points. The wallet that signs
gets the points.

## Areas and rounds

A scan covers one **area**: the scannable files of one tier of
`security/surface.txt` (`SCAN_AREAS` in `packages/core/src/scan`). A
file that several entries cover takes the lowest tier.

| Area       | Label             | Tier |
| ---------- | ----------------- | ---: |
| `keys`     | Key material      |    1 |
| `signing`  | Signing           |    2 |
| `boundary` | Trust boundary    |    3 |
| `preview`  | Approval preview  |    4 |
| `build`    | Build and release |    5 |

A wallet scans each area once per release, so it can run up to five
**rounds** on one release. A wallet's first non-voided scan of a release
is round 1, and each round earns 10% of the base reward more than the
last: round 2 earns 110%, round 3 120% (`roundReward`, truncated to an
atomic integer).

`GET /scan/challenge` without `area` picks the area with the smallest
share of its functions examined, the lower tier on a tie. It draws the
3 functions from that area only, and from the unexamined ones while
there are any.

**Coverage carries across releases.** The server keeps a SHA-256 of
each answered function's text at the attestation's commit. A function
counts as examined on a release when a non-voided scan answered it on
that release, or on any release where its text was the same. Moving a
function within its file doesn't change its text; editing it does. So
each release's challenges go to new and changed functions first.

### The CLI

A session keeps each round in its own folder,
`.gleam-scan/rounds/<area>/`: `challenge.json`, `attestation.json`,
`area-files.txt`, `started-at`, the round's leads, candidate notes and
`pr-*.md` / `advisory-*.md` drafts, `finished.json` once `finish` passes,
`signed.json` once the server has the signature, and `filed.txt`, the
reports the agent filed. `.gleam-scan/current` names the round in
progress, and `.gleam-scan/declines` counts the sign requests the user
has left unanswered, so a new session keeps the count. A round is **open** until `finish` passes, **waiting** until
`next` sees its signature, then **signed**.

| Command | Does | Ends with |
| --- | --- | --- |
| `pnpm scan start [--area <id>]` | Without `--area`, points at an open round here if there is one, else picks the least-covered area (`GET /scan/areas`) with no round folder here. Refuses an area that is waiting or signed here. Writes the round folder and `current`. Moves rounds of an older release to `.gleam-scan/v<x>/`. | With no area left: the file offer, or "This wallet has scanned every area". |
| `pnpm scan finish [--area <id>]` | Checks the round locally and with `POST /attestations/check`, and marks it waiting. | The round offer. |
| `pnpm scan file` | Re-checks every waiting round. A round the check rejects is open again (a network or server error leaves it waiting), and its `✗` line names the `pnpm scan start --area <id>` that re-answers it. | The sign request: one link, every waiting round's payload joined with `.`, in round order. |
| `pnpm scan next` | Calls `GET /scan/next` for each waiting round, writes `signed.json` for each signed one and clears `declines`, then re-checks the unsigned rounds as `file` does. A dead one gets a `✗` line naming the `start --area` and `finish --area` that answer it again, and no closing message. Safe to run again. | The sign request for rounds still unsigned, else the next round offer from the server's answer for the last signed round. |

Every closing message prints under `Show the user exactly this, as the
last thing you write:` (`--json`: `closingHeader` and `userMessage`).
Examples:

> Round 2 (Signing) is ready. 2 rounds and 3 reports are waiting to be
> signed. Round 3 earns 14.88 points even with no findings, and nobody
> has examined 97 of the 137 functions in Trust boundary yet. Reply
> "next" to scan it, or "file" to sign and file everything.

> Signed: 3 rounds earned 38.12 points. Round 4 earns 14.88 points even
> with no findings, and nobody has examined 40 of the 60 functions in
> Build and release yet. Reply "next" to scan it.

`finish` forecasts the next round: its number is the wallet's last
signed round known here plus the rounds waiting plus 1, and its base
reward is the amount from `GET /scan/rewards` while paid places are
left after the waiting rounds take theirs. `next` takes both from
`GET /scan/next`. With no paid place left the offer says the round is
recorded but earns no points, and still offers it. With no area left
`finish` offers only "file", and `next` says the next release opens new
rounds. Points show with two decimals below 1,000, as in the extension.

A scan from before areas has `area` and `round` null and counts as one
round of its release. `GET /scan/areas` gives each area's function
count, how many of them are examined, and its scan count on the release.

## The attestation

```json
{
  "release": "1.4.0",
  "commit": "<40-char sha of the tag>",
  "model": "claude-opus-5-5",
  "challenge": "<challenge id>",
  "answers": [
    { "file": "<surface file>", "symbol": "<function>", "line": 212,
      "check": "<one sentence: what this line prevents>" }
  ],
  "result": "pass",
  "report": "<markdown: what was checked and what wasn't>"
}
```

- `result` is `pass` if the agent reported nothing, and `scanned` if it
  filed a fix PR, hardening PR or advisory. A skill or surface PR
  doesn't count. It
  never says what was found.
- `report` describes coverage, not vulnerabilities. Details of a
  medium-or-above issue go only in the advisory.
- `model` is a self-reported label. It's shown on `review-results.html` and has no
  effect on points, so there is nothing to gain by faking it.

**Signing.** `attest.html` passes the attestation to the extension
through `externally_connectable`, the same channel the invite code
uses. The extension opens its own approval window, then signs
`gleam-points:attest:v1:<release>:<sha256 of the attestation>` the same
way it signs points registration. The link carries the attestation in
its fragment as `<payload>`: base64url, without padding, of the UTF-8
canonical JSON, so the page decodes it with plain JS (base64url, UTF-8,
`JSON.parse`) and the fragment never reaches a server. Hardware wallets use the transaction
proof. A dApp's `signMessage` is never involved, so the site needs no
wallet connection. That sha256 is the **attestation id**. Every PR and
advisory a scan files includes it, which links each finding to a
wallet. The id only names the wallet: any attestation that wallet signed
and that isn't voided can carry a finding, whichever round or release
found it. A round's own id is the default, and a wallet that has used
all five rounds can still report and earn.

The points API stores attestations. Nothing goes on-chain or into git.
`GET /attestations?release=<v>` returns each attestation with its
signature and owner key, so anyone can verify it without trusting
Gleam.

`POST /attestations` rejects an attestation unless:

1. The signature is valid, and the wallet is registered and live.
2. `release` is the latest release and `commit` matches its tag.
3. The challenge is unexpired and unused, and every answer passes the
   automatic check (see Proof of scan).
4. The wallet hasn't already scanned this area of this release. The
   failure names an area that is still free, or says every area is done.
5. The release has a paid place left (Points). If not, the
   attestation is still recorded, with no points.

`POST /attestations/check` runs checks 2 and 3 and the attestation's
shape, without a signature, and fails with the same issues as the
submission. It uses up nothing, so `pnpm scan finish` can run it as
often as it needs. The server checks the release and the code at the
tag's commit, read from GitHub.

## Proof of scan

No one can prove an agent actually read the code. The goal is to make
faking a scan cost about as much as doing one, and to pay little for a
fake.

**Challenge.** `pnpm scan start` calls `GET /scan/challenge`. The
server picks 3 functions at random from the area's files and returns
them with a challenge id and the area. The area is stored on the
challenge, so the attestation itself doesn't name it. It picks only
functions that make a check: their own body has an `if`, `throw` or
`switch`, not counting nested functions, strings or comments. The challenge expires after 72 hours,
so a session can sign every round at the end, and can be used once. For each function, the agent names the line of a
security check that function makes, and says in one sentence what the
check prevents.

The challenge stops two cheats:

- **Copying.** Each attestation gets different functions, so one real
  scan can't be signed by many wallets.
- **Signing without scanning.** The answers can't be written without
  reading the code at that commit.

**Automatic check.** The check confirms that each cited line lies
inside the named function and isn't blank or a comment. It's a pure
function in `packages/core`, so `pnpm scan finish` and the server run
the same code. The agent sees a failure before the user is asked to
sign.

**Human check.** Every `report` and every answer is public on
`review-results.html`, so an empty or generic report stands out. A maintainer
voids it with `scan-void`, which removes its points and frees its paid
place.

**Limited payoff.** A scan earns a small, fixed amount, and a release
pays at most 100 scans, fewer when little of its code is unexamined.
Each further round adds only 10% of that amount. Finding real
problems pays far more, and that can't be faked.

## Points

Both amounts scale with the holding points Gleam pays out, so rewards
rise as the community grows.

**Paid places.** A release opens one paid place for every 3 of its
functions that aren't examined (Coverage carries across releases),
rounded up, at least 1 and at most 100 (`paidPlacesFor`). The number
is fixed the first time the release is asked for, normally by its first
challenge, so it doesn't fall as scans examine functions. A patch
release with nothing unexamined opens 1;
releases scanned before this rule opened 100.

**Scans.** Each paid scan earns **0.1% of the previous day's total
holding points**, credited as soon as it's accepted. Every paid place
answers unexamined code, so each earns the same; the place count, not
the rate, keeps total spend in line with the work. Once the paid places are taken,
scans are still recorded and shown but earn nothing. Each round takes a place like any
other scan, and earns the place's amount times its round multiplier
(Areas and rounds). A scan that earns no points, such as one made before the
first daily snapshot, doesn't use up a paid place. `scan.html`,
`review-results.html` and the extension's Points screen show how many paid
places are left. `pass` and `scanned` earn the same, and so
does every model.

**Findings.** Each day the bounty pool grows by 2% of that day's
holding points. An accepted finding takes a share of the pool's current
balance:

| Accepted as                       | Share |
| --------------------------------- | ----: |
| Critical                          |   50% |
| High                              |   25% |
| Medium                            |   10% |
| Low, or a merged hardening PR     |    2% |
| Bonus: a merged fix for a finding |   +1% |

A finding's fix earns the bonus when it merges largely as written: a fix
PR for a low finding, or a patch in a medium-or-above advisory. A public
PR for a medium-or-above finding earns no bonus.

The pool grows while nothing is found, so bounties rise over time.
Only the first report of a root cause earns. A finding in the release
that master has already fixed earns at its rating like any other, since
users run the release until the next one ships. The scan reports it as
an advisory that says so, since there is no fix left to make. Points carry no promised
value or conversion ratio.

These are the current values. They are tuned per release.

## Reviewing findings

- **PRs:** review and merge as usual; nothing merges automatically. A
  PR that restates a By design entry is closed with a link to that
  entry.
- **Advisories:** check for an `Attestation id:` line first. If it is
  missing or reads `none`, comment on the advisory asking for the id of
  any attestation the reporter's wallet has signed, while it is still in
  triage, since only the id links the finding to a wallet. Then reproduce the finding, set the real severity, fix it
  privately, ship the fix, and publish the advisory with credit to
  the reporter. Close duplicates, reports that don't reproduce, and
  by-design reports with a one-line reason.
- **Fix bonus:** once a reporter's fix merges, pay it with
  `--severity fix` and the finding's `--ref`.

To pay a finding, run the award script locally, as with `drop-code`:

```bash
DATABASE_URL=… pnpm --filter @gleam/points-api scan-award --attestation <id> --severity high --ref <url>
DATABASE_URL=… pnpm --filter @gleam/points-api scan-void --attestation <id>
```

`scan-award` shows the pool balance, the share and the amount, and asks
for confirmation. It won't pay the same `--ref` twice. `scan-void`
removes the points of an attestation that shows no real work and keeps
any finding points. The server has no admin endpoint.

## By design

Gleam follows **informed security** for the choices it leaves to the
user. It defaults to the stronger guarantee, and the user may turn it
off once they've been told the risk. Such a setting is not a finding in
itself. It becomes one if the user isn't told, can't see the current
setting, or the setting can change without them. Other by-design
entries are fixed trade-offs, each with its own reason. Only what an
entry names is by design.

The entries are in
[`docs/THREAT_MODEL.md` § By design](docs/THREAT_MODEL.md#by-design).
Each gives the decision, why it was made, and a *Still a finding if*
clause naming the harm a reporter must concretely demonstrate, by any
path, for it to still count.
When a maintainer rejects a report as by design, they add an entry for
it.

## The skill: `security/scan/SKILL.md`

[`security/scan/SKILL.md`](security/scan/SKILL.md) is written for any
coding agent to follow literally, with the exact commands. Three companion
files sit beside it:
[`CHECKS.md`](security/scan/CHECKS.md), the questions to ask in each area
and the classes of bug that cut across them, and
[`VERIFY.md`](security/scan/VERIFY.md), which a fresh subagent (or the
scanning agent itself) follows to try to disprove one finding and rate
what survives, and [`REPORT.md`](security/scan/REPORT.md), the shape and
style of an advisory or PR body. In summary:

1. Check out the latest release tag and run `pnpm scan start`, with
   `--area <id>` when the user names an area. It writes the round folder
   `.gleam-scan/rounds/<area>/` with the challenge, the area's files and
   a starter attestation.
2. Read `docs/THREAT_MODEL.md` first. Its attackers, out-of-scope list
   and By design entries are given. Where the docs and the code
   disagree, the code is right; fix the docs in a PR.
3. Run the tests and `osv-scanner`.
4. Review the area's files that changed since the last release, then
   the rest of the area, following anything they reach, with
   `CHECKS.md`.
5. Look anywhere else that seems worth it. The surface is where to
   start, not the limit.
6. Try to disprove each finding with `VERIFY.md`, in a fresh subagent
   where the agent can start one. A round's review, and each draft, can
   run in a fresh subagent too (the skill's Round brief and Draft brief). Only findings that survive get
   drafted, at the severity the verdict gives. Each survivor is then
   checked against `origin/master`. One that master already fixes is
   drafted as an advisory that says so, never as a fix PR.
7. Draft the reports, as `REPORT.md` says. PRs are the default: low or
   informational issues, hardening, and anything that would have made
   the scan better (a missing surface file, a check the skill should
   name, a command that misled). Every scan considers at least one PR
   candidate, such as a fix, a test that pins a security property, a
   `security/surface.txt` entry or a skill change, and drafts it if it is
   real. A weak PR is closed and earns nothing. Medium and above go in a
   private advisory, never a PR or a public issue, with the fix as a
   patch inside it when the agent has one. File nothing yet,
   since each one has to quote the attestation id.
8. Answer the challenge from the code you read by filling in the
   round's `attestation.json`. Run `pnpm scan finish` until it passes,
   and end the turn with the round offer it prints. From then on, every
   turn ends with exactly one closing message the CLI printed, word for
   word, with nothing after it. On "next", run `pnpm scan start` and
   repeat from step 4. On "file", run `pnpm scan file` and end with its
   sign request. On "signed", run `pnpm scan next`, file the signed
   rounds' drafts with their attestation ids, and list one link per line
   above `next`'s closing message.

**Report like a working security engineer:**

- Name a realistic attacker from the threat model, and show the
  concrete steps from the attacker's access to the harm. An attack that
  needs a compromised OS, malware, or the user's password is out of
  scope.
- Rate severity with the anchors in `VERIFY.md`: by what was shown, not
  the worst case you can imagine.
- Missing defence in depth is not a finding unless it enables a real
  attack.
- Say once whether a finding was demonstrated, traced or needs a
  browser check, then write plainly.
- Above `<details>`, put only the title and a plain summary of about
  100 words at reading grade 6 to 7. Everything else goes inside it.
- A clean `pass` earns the same as `scanned`. Padding a report with
  weak findings earns nothing.

Never use a seed phrase, a real key, a real wallet, or real funds.

## In the extension

Under Version and Commit in Settings:

```text
Community scans        7 scans  →
```

The row opens `review-results.html?v=<version>`. It shows a count only,
never a "secure" or "verified" badge. Text from the API renders as plain
text on both site pages.

`scan.html` is the security reviews page. It reads top to bottom as an
introduction for someone new to reviews:

1. **What it is and the two ways to help:** review a release, or report
   a vulnerability. The rewards come last, in one line.
2. **The record** for the current release: the version, how many
   reviews, functions examined and models used (the release listing
   and `GET /attestations/count`). Every figure can be checked on
   `review-results.html`. The row is hidden until all of them arrive.
3. **Review a release:** the line to paste, the four steps, what you
   need, the areas with how much of each is examined (`GET /scan/areas`),
   and the review rewards with paid places left, what the next review
   earns and the 10% step per round (`GET /scan/rewards`).
4. **Reporting vulnerabilities:** private reporting on GitHub, the
   bounty pool's balance, and the bounty rules, with severity set by
   the criteria in `SECURITY.md`.
5. **A disclaimer** that community reviews don't replace a professional
   audit, then common questions.

Without the live figures it still shows the rules.

`review-results.html` is the public record, for the release in `?v=` or
the latest. A `#<attestation id>` opens that entry. It shows:

- **Coverage.** For example, "41 of 64 security functions examined by
  at least one review", split by area, with the functions no one has
  examined yet listed. For the latest release this counts scans of
  earlier releases where a function is unchanged; for an older one,
  only that release's own scans. The figure comes from the challenge answers, which the server
  has already checked against the code, so a made-up model label can't
  raise it.
- **Attestations.** Each with its area, round, model label, result,
  date and report.
- **Models not yet used.** For example, "Not yet used on v1.4: Gemini
  3, DeepSeek V4, Qwen 3". These are names from a short list in
  `apps/site` that aren't among the release's labels. Next to it: *A
  different model tends to find different bugs. Confirmed
  vulnerabilities are awarded a share of the bounty pool.* Trying a new model earns no extra scan
  points. The payoff is the better chance of a bounty.
- **A way back to `scan.html`** to run a scan.
