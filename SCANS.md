# Community release scans

Anyone can point an AI agent at a Gleam release, scan it for security
issues, and earn Gleam Points. Each scan leaves a public, signed
attestation, and the extension shows the attestations for the version
installed.

Community scans add to the maintainers' pre-tag audit. They are not a
professional audit.

## How it works

1. **Hand the page to your agent.** Settings → Community scans opens
   `gleamwallet.app/scan.html`. It has one line to copy into your coding
   agent.
2. **The agent scans.** It checks out the latest release tag and runs
   `pnpm scan start`, which fetches a challenge. Then it follows
   `security/scan/SKILL.md` from that checkout.
3. **The agent reports what it finds.** Low or informational issues go
   in a PR. Medium and above go in a private GitHub advisory.
4. **The agent checks its own work.** `pnpm scan finish` runs the same
   checks the server runs and prints a link. If a check fails, the
   agent fixes it before you see anything.
5. **You sign.** Open the link. Gleam shows a window with the release,
   the model, the result and the report. Approve, and the extension
   submits the attestation. The agent never touches a key.
6. **You get points straight away.** The window shows "+N points".
   Finding points arrive when a maintainer accepts the finding.

You need a Gleam wallet registered for points. The wallet that signs
gets the points.

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
  filed a PR or an advisory. It never says what was found.
- `report` describes coverage, not vulnerabilities. Details of a
  medium-or-above issue go only in the advisory.
- `model` is a self-reported label. It's shown on `scan.html` and has no
  effect on points, so there is nothing to gain by faking it.

**Signing.** `attest.html` passes the attestation to the extension
through `externally_connectable`, the same channel the invite code
uses. The extension opens its own approval window, then signs
`gleam-points:attest:v1:<release>:<sha256 of the attestation>` the same
way it signs points registration. Hardware wallets use the transaction
proof. A dApp's `signMessage` is never involved, so the site needs no
wallet connection. That sha256 is the **attestation id**. Every PR and
advisory a scan files includes it, which links each finding to a
wallet.

The points API stores attestations. Nothing goes on-chain or into git.
`GET /attestations?release=<v>` returns each attestation with its
signature and owner key, so anyone can verify it without trusting
Gleam.

`POST /attestations` rejects an attestation unless:

1. The signature is valid, and the wallet is registered and live.
2. `release` is the latest release and `commit` matches its tag.
3. The challenge is unexpired and unused, and every answer passes the
   automatic check (see Proof of scan).
4. The wallet hasn't already attested this release.
5. The release has fewer than 20 paid scans so far.

## Proof of scan

No one can prove an agent actually read the code. The goal is to make
faking a scan cost about as much as doing one, and to pay little for a
fake.

**Challenge.** `pnpm scan start` calls `GET /scan/challenge`. The
server picks 3 functions at random from the security-surface files and
returns them with a challenge id. It picks only functions that make a
check: their own body has an `if`, `throw` or `switch`, not counting
nested functions, strings or comments. The challenge expires after 24 hours
and can be used once. For each function, the agent names the line of a
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
`scan.html`, so an empty or generic report stands out. A maintainer
voids it with `scan-void`, which removes its points.

**Limited payoff.** A scan earns a small, fixed amount, and only 20
scans are paid per release. Finding real problems pays far more, and
that can't be faked.

## Points

Both amounts scale with the holding points Gleam pays out, so rewards
rise as the community grows.

**Scans.** A scan earns **0.1% of the previous day's total holding
points**, credited as soon as it's accepted. The first 20 scans of each
release are paid. After that, scans are still recorded and shown but
earn nothing. `scan.html` shows how many paid places are left. `pass`
and `scanned` earn the same, and so does every model.

**Findings.** Each day the bounty pool grows by 2% of that day's
holding points. An accepted finding takes a share of the pool's current
balance:

| Accepted as                   | Share |
| ----------------------------- | ----: |
| Critical                      |   50% |
| High                          |   25% |
| Medium                        |   10% |
| Low, or a merged hardening PR |    2% |

The pool grows while nothing is found, so bounties rise over time.
Only the first report of a root cause earns. Points carry no promised
value or conversion ratio.

These are the current values. They are tuned per release.

## Reviewing findings

- **PRs:** review and merge as usual; nothing merges automatically. A
  PR that restates a By design entry is closed with a link to that
  entry.
- **Advisories:** reproduce the finding, set the real severity, fix it
  privately, ship the fix, then publish the advisory with credit to
  the reporter. Close duplicates, reports that don't reproduce, and
  by-design reports with a one-line reason.

To pay a finding, run the award script locally, as with `drop-code`:

```bash
DATABASE_URL=… pnpm --filter @gleam/points-api scan-award --attestation <id> --severity high --ref <url>
```

It shows the amount and asks for confirmation. It won't pay the same
`--ref` twice. `scan-void --attestation <id>` removes an attestation
that shows no real work. The server has no admin endpoint.

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
clause naming what a reporter could demonstrate that would still count.
When a maintainer rejects a report as by design, they add an entry for
it.

## The skill: `security/scan/SKILL.md`

1. Check out the latest release tag and run `pnpm scan start`.
2. Read `docs/THREAT_MODEL.md` first. Its attackers, out-of-scope list
   and By design entries are given. Where the docs and the code
   disagree, the code is right; fix the docs in a PR.
3. Run the tests and `osv-scanner`.
4. Review the files in `security/surface.txt` that changed since the
   last release, then the rest of the surface.
5. Look anywhere else that seems worth it.
6. Report: low or informational issues in a PR, medium and above in a
   private advisory. Never as a public issue.
7. Answer the challenge from the code you read and write the
   attestation. Run `pnpm scan finish` until it passes, then give the
   user the link it prints.

**Report like a working security engineer:**

- Name a realistic attacker from the threat model, and show the
  concrete steps from the attacker's access to the harm. An attack that
  needs a compromised OS, malware, or the user's password is out of
  scope.
- Rate severity by what is likely, not the worst case you can imagine.
- Missing defence in depth is not a finding unless it enables a real
  attack.
- Say once whether a finding was demonstrated or is suspected, then
  write plainly.
- A clean `pass` earns the same as `scanned`. Padding a report with
  weak findings earns nothing.

Never use a seed phrase, a real key, a real wallet, or real funds.

## In the extension

Under Version and Commit in Settings:

```text
Community scans        7 scans  →
```

The row opens `scan.html?v=<version>`. It shows a count only, never a
"secure" or "verified" badge. Text from the API renders as plain text.

`scan.html` shows, for the release:

- **Coverage.** For example, "41 of 64 security functions examined by
  at least one scan", with the functions no one has examined yet
  listed. The figure comes from the challenge answers, which the server
  has already checked against the code, so a made-up model label can't
  raise it.
- **Attestations.** Each with its model label, result, date, report
  and challenge answers.
- **Models not yet used.** For example, "Not yet used on v1.4: Gemini
  3, DeepSeek V4, Qwen 3". These are names from a short list in
  `apps/site` that aren't among the release's labels. Next to it: *A
  different model tends to find different bugs. Accepted findings pay
  from the bounty pool.* Trying a new model earns no extra scan
  points. The payoff is the better chance of a bounty.
- **What an attestation means**, how points work, and a block of
  instructions for agents.
