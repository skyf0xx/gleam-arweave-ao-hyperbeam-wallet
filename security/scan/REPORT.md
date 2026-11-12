# Write an advisory or PR body

A maintainer reads your report first in a list of many. The title and
summary tell them in one minute what it is and how bad it is, in plain
words. Everything else goes in a `<details>` block for the agent that
triages and fixes it.

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

A maintainer sees only the title and the summary. Everything else goes in
`<details>`, for the agent that triages and fixes it.

- `Title: <title>` as the first line. Filing sends it as the advisory's
  title and the rest as its description.
- **Summary**: a short paragraph in plain words. Say what is wrong, who
  it affects, what they lose and how bad it is. Say whether a test shows
  it, a trace shows it or it needs a browser check. If master already
  fixes it, end with `Already fixed on master in <ref>.`
- `Attestation id: {{ATTESTATION_ID}}`
- A `<details><summary>Details</summary>` block, written for an agent:
  - **Impact**: who is affected, what they lose, the severity and why;
  - **Steps**: numbered, from the attacker's access to the harm;
  - **Fix** (optional): one line, or the fix and its test as a `diff`
    block against `origin/master`;
  - the six-field table from `VERIFY.md` (Attacker, Entry, Control,
    Boundary, Harm, Evidence);
  - the `file:line` trace;
  - any test code;
  - at most one line on why it isn't a duplicate of a named earlier
    advisory.

## Style

Above `<details>`:

- Write for a person who doesn't read the code. No file, function or
  tag names.
- Keep to about 100 words, at reading grade 6 to 7.
- Use short sentences, one claim each. Use common words.
- Use active voice and the present tense.
- Cut hedges, filler and adjectives. Don't argue that it isn't by design.

Inside `<details>`, be exact and complete. Code names, `file:line` and
test code belong there.

`pnpm scan finish` and `pnpm scan file` warn when an `advisory-*.md`
draft in a round folder has no `Title:` line, a title over 100
characters or with a check id, code name or parenthetical, more than 120
words above `<details>`, or a reading grade above 8. The warning never
fails the scan. Fix the draft and move on.

## Example advisory

This example is invented. It shows the shape, not a real bug.

```markdown
Title: A connected site can get a signature on an action the user never sees

**Summary**: The approval window shows only the first 16 tags of a
request. A site can put an extra tag after them. The user can't see it,
but Gleam signs it. So a site can slip in an action the user would
refuse, like a token send. The user still has to click Approve, so this
is Medium. A unit test shows it.

Attestation id: {{ATTESTATION_ID}}

<details><summary>Details</summary>

**Impact**: Any user who approves a `signDataItem` request from a hostile
page. The page gets a signature on a tag the user didn't review, such as
an AO `Action` they would refuse. Medium: the preview lies, but the user
still has to approve.

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
| Evidence | Demonstrated: the test below |

Trace: the `file:line` steps from the page call to the preview.

Test: the throwaway test that shows the 17th tag is signed but not shown.

Not a duplicate of GHSA-xxxx-xxxx-xxxx, which covered tag values, not
tag count.

</details>
```

## PR body

The title stays a Conventional Commit. Write the part after
`fix(security):` in a user's words too, with no code names.

Follow `.github/PULL_REQUEST_TEMPLATE.md`, in the same style:

- **Why**: one to three sentences on the problem the PR fixes.
- **What**: one to three sentences, or a short list, on the change.
- **Attestation id**: `Attestation id: {{ATTESTATION_ID}}`.
- **Checklist**: tick only what you ran.

Put any trace or long reasoning in a `<details>` block under **What**. A
PR never holds the details of a medium or higher issue.
