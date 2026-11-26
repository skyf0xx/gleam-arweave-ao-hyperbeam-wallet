# Write an advisory

A maintainer reads your report first in a list of many. The title and
summary tell them in one minute what it is and how bad it is, in plain
words. The rest is for the agent that triages and fixes it.

## Advisory title

The title is the line a maintainer sees in the advisory list. Name the
risk, not the mechanism. A title has up to three parts, in this order:

1. **Who** can do it. The actor carries the preconditions: "any site",
   "a connected site", "anyone on the network".
2. **The harm.** Ask "leading to?" until the answer is one of these:
   - funds stolen, or sent where the user didn't intend;
   - a signature or account control the user didn't knowingly give;
   - addresses, balances or activity exposed;
   - the user locked out, or a revoked site keeping access;
   - unaudited code that can ship.
3. **The cover** (optional): what the user thinks is happening.

Write each part as a user would say it. If a part only makes sense to
someone who reads the code, go up a level. If it fits any bug, come down
a level. Put the specifics in the Summary.

Keep it to one sentence of about 100 characters. Don't put in:

- scan check ids (`T-A1`, `C-1`), function, component or tag names, or
  CWE names;
- the severity, a hedge such as "(weak)", or a parenthetical;
- a second issue. File it as its own advisory;
- how to trigger it.

| Mechanism title | Risk title |
| --- | --- |
| L1 token transfer reader misses transfers the scheduler still executes, so the approval preview shows an AR send instead of a token transfer | A connected site can steal the user's whole token balance with a request disguised as a send |
| Pending signing request survives revocation of its origin's grant | A revoked site can still get a signature from a request it queued earlier |
| T-A2: isTokenAdded is a permissionless oracle over the local watched token list (weak) | Any site can learn which tokens a wallet watches |
| D-B-1: release gate surface omits control files, so changes to them pass with no re-audit | Changes to release-gate files can ship without a re-audit |

Two findings with the same risk get titles of the same shape. That is
correct: it shows the maintainer one class of bug, not two.

## Advisory shape

GitHub only accepts a report in the shape of the repository's report form,
[`.github/VULNERABILITY_REPORT.yml`](../../.github/VULNERABILITY_REPORT.yml),
through the API as well as on the site. The draft is that form's sections
as `### <label>` headings, in the form's order, each with its answer under
it:

- `Title: <title>` as the first line. Filing sends it as the advisory's
  title and the rest as its description.
- `### Summary`: a short paragraph in plain words. Say what is wrong, who
  it affects, what they lose and how bad it is. Say whether a test shows
  it, a trace shows it or it needs a browser check. If master already
  fixes it, end with `Already fixed on master in <ref>.`
- `### Severity`: `Medium`, `High` or `Critical`, what the table in
  [SECURITY.md § Severity](../../SECURITY.md#severity) gives for your
  Loss and Requires, never more. The form offers nothing lower: a Low
  finding isn't filed.
- `### Attacker`: a row of `docs/THREAT_MODEL.md` § Attackers, word for
  word.
- `### Loss`: `key`, `unapproved`, `mismatch`, `control`, `disclosure` or
  `lockout`.
- `### Requires`: `none`, `one-click`, `unusual` or `rare`.
- `### Fix location`: `<file>#<function>`, the function a fix has to
  change at the tag, not where the symptom shows. Two reports of one bug
  usually name the same function, which is how a maintainer groups them.
- `### Attestation id`: `{{ATTESTATION_ID}}`.
- `### Failing test`: a ```` ```ts ```` block with a Vitest `it(…)` that
  fails at the release tag and shows the loss.
- `### Details`, written for an agent:
  - **Impact**: who is affected, what they lose, and why the answers
    above hold;
  - **Steps**: numbered, from the attacker's access to the harm;
  - **Fix** (optional): one line, or the fix and its test as a `diff`
    block against `origin/master`;
  - the six-field table from `VERIFY.md` (Attacker, Entry, Control,
    Boundary, Harm, Evidence);
  - the `file:line` trace;
  - at most one line on why it isn't a duplicate of a named earlier
    advisory.

If you're unsure between two answers, pick the one your test shows. The
maintainer answers Attacker, Loss and Requires the same way. A report
rated above what its own answers and test show, a repeat of a published
advisory, and a report that only restates a By design entry each lose
the scan points of the attestation they quote (SCANS.md § Quality rules).

## Style

In the title and the Summary:

- Write for a person who doesn't read the code. No file, function or
  tag names.
- Keep the Summary to about 100 words, at reading grade 6 to 7.
- Use short sentences, one claim each. Use common words.
- Use active voice and the present tense.
- Cut hedges, filler and adjectives. Don't argue that it isn't by design.

In Details and the Failing test, be exact and complete. Code names,
`file:line` and test code belong there.

`pnpm scan finish` and `pnpm scan file` warn when an `advisory-*.md`
draft in a round folder has no `Title:` line, a title over 100
characters or with a check id, code name or parenthetical, a Summary of
more than 120 words, or a reading grade above 8. The warning never
fails the scan. Fix the draft and move on.

They fail the run, with a `✗` line naming the fix, when an advisory
draft is missing a section or the failing test, rates itself above what
its Loss and Requires give, rates itself Low, names an attacker the
threat model doesn't list, or names a fix location that isn't a function
at the tag, and when the round folder holds a `pr-*.md` draft.

## Example advisory

This example is invented. It shows the shape, not a real bug.

````markdown
Title: A connected site can get a signature on an action the user never sees

### Summary

The approval window shows only the first 16 tags of a request. A site
can put an extra tag after them. The user can't see it, but Gleam signs
it. So a site can slip in an action the user would refuse, like a token
send. The user approves what looks like a normal request, so this is
High. A unit test shows it.

### Severity

High

### Attacker

Malicious website or dApp

### Loss

mismatch

### Requires

one-click

### Fix location

packages/app/src/approval/TagList.tsx#TagList

### Attestation id

{{ATTESTATION_ID}}

### Failing test

```ts
it("signs a 17th tag the preview doesn't show", () => {
  // the test that shows the 17th tag is signed but not shown
});
```

### Details

**Impact**: Any user who approves a `signDataItem` request from a hostile
page. The page gets a signature on a tag the user didn't review, such as
an AO `Action` they would refuse. High: the preview leaves out what is
signed (`mismatch`), and one ordinary approval is enough (`one-click`).

**Steps**:

1. The user connects to a hostile page.
2. The page calls `signDataItem` with 16 harmless tags and a 17th
   `Action: Transfer` tag.
3. The approval window lists the first 16 tags.
4. The user clicks Approve.
5. Gleam signs the item with all 17 tags.

**Fix**: Render every tag, and scroll the list.

| Field | |
| --- | --- |
| Attacker | A malicious dApp page |
| Entry | `signDataItem` with 17 tags |
| Control | The approval preview |
| Boundary | A signature the user didn't review |
| Harm | A preview that lies |
| Evidence | Demonstrated: the failing test |

Trace: the `file:line` steps from the page call to the preview.

Not a duplicate of GHSA-xxxx-xxxx-xxxx, which covered tag values, not
tag count.
````

## No PRs

A scan files no PRs. Nothing below Medium earns, so a Low finding is
dropped, and a Medium-or-above fix goes as a patch inside its advisory.
