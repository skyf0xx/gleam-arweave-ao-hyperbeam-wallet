---
name: gleam-scan-verify
description: Try to disprove one candidate security finding in a Gleam release checkout, then rate what survives. Used by Step 6 of the Gleam scan skill, either by a fresh subagent or by the scanning agent itself.
---

# Verify a Gleam scan finding

You get one candidate finding from a scan of a Gleam release: a note at
`.gleam-scan/candidates/<n>.md` in a checkout of the release tag. Your job
is to **disprove it**. Assume it is wrong until the code, read by you,
says otherwise. A finding that survives an honest attempt to break it is
worth reporting. One that doesn't would have cost a maintainer an hour to
close.

If someone else found this candidate, don't take their trace on trust.
Re-read every line it cites, and look for what it missed.

## Rules

- Never use a seed phrase, a real key, a real wallet, or real funds.
- Don't move the checkout's `HEAD`, commit, push, or file anything.
- Don't publish anything about the candidate anywhere.
- A throwaway test you write is deleted before you finish.

## 1. Read the candidate and the threat model

Read the note, then the **Attackers**, **By design**, **Known
limitations** and **Out of scope** sections of `docs/THREAT_MODEL.md`.

## 2. Check it meets the bar

A finding names all six of these. If one is missing and you can't supply
it from the code, the candidate is refuted.

| Field | The question it answers |
| --- | --- |
| Attacker | Which attacker from the threat model's table? |
| Entry | What can that attacker send or do: a page message, a network response, a PR? |
| Control | Which control should stop it: an origin check, an approval, a schema, the lock? |
| Boundary | What does the attacker reach that they shouldn't? |
| Harm | What is lost or wrong: a key, a signature the user didn't approve, a preview that lies, a disclosed secret? |
| Evidence | The path from entry to harm as `file:line` steps, and whether a test demonstrated it. |

## 3. Re-trace it and look for what stops it

Read the cited code yourself, from the attacker's entry to the harm.
At each step, ask what would stop the attack, and check every layer, not
only the one the note cites. Gleam's real controls include:

- the origin taken from Chrome's `sender`, never from the message body;
- the top-frame and secure-origin checks in `apps/extension/src/sender.ts` and `packages/core/src/policy/signing-origin.ts`;
- each method's caller tier and zod schema in `packages/runtime/src/dispatch/methods.ts`;
- the approval window, a separate extension window that a page is meant
  to be unable to draw, frame or answer;
- non-extractable unlocked keys, and `chrome.storage.session` limited to
  trusted contexts;
- the extension CSP, MV3 isolation between page and extension, and
  Chrome's same-origin policy.

Then check the common reasons a candidate fails:

- It restates a **By design** entry without showing the harm that
  entry's *Still a finding if* clause names.
- It is already a **Known limitation**, or it is **Out of scope**: it
  needs a compromised OS or browser, malware, the user's password or
  keyfile, or another extension with broad permissions.
- The attacker could already do the same thing through a legitimate
  path, or the only one harmed is the attacker.
- It is missing defence in depth with no attack it enables.
- It is a crash or an error with no security effect.
- It is a vulnerable dependency whose affected code Gleam doesn't reach.

## 4. Try to demonstrate it

If the trace holds, write the smallest throwaway unit test that shows
the harm, for example one that feeds the malformed input to the function
and asserts on what comes back. Run it with
`pnpm vitest run <path-fragment>`. A test that shows the harm makes the
finding **demonstrated**. Stop at the smallest effect that proves the
point. Delete the test when you are done.

Some facts can't be shown in a unit test: how Chrome routes a message,
what a real browser renders, whether a permission prompt appears. If the
finding turns on one of these, it **needs a browser check**. Name the
exact fact and how a maintainer can check it in Chrome with a test
wallet.

## 5. Rate what survives

Rate by what you showed under realistic conditions, not the worst case
you can imagine. The severity can't be higher than the harm you
demonstrated.

Use the levels in [SECURITY.md § Severity](../../SECURITY.md#severity).

To tell high from medium, ask: does it fully defeat a control for an
action with real consequences, or only weaken it? If you can't state
the concrete damage, the severity is lower than it feels.

For a finding that needs a browser check, give the severity it would
have if the check comes out the bad way, and say it is unconfirmed.

## 6. Return the verdict

Return exactly this block, and nothing about the candidate in any other
place:

```text
Candidate: <n>
Verdict: holds | holds, weaker | needs a browser check | refuted
Severity: critical | high | medium | low | informational | none
Evidence: demonstrated | traced | needs a browser check: <the exact fact>
Reason: <one to three sentences: what you checked, and what settled it>
Corrections: <a changed field from step 2, with the reason, or "none">
```

`holds, weaker` means the finding is real at a lower severity or a
narrower scope than the note claims. Put the narrower version under
**Corrections**. A refuted candidate gets severity `none`.
