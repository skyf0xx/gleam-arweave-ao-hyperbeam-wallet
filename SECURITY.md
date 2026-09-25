# Security Policy

Gleam is a browser-extension wallet holding user private keys. Please report
vulnerabilities privately rather than through a public GitHub issue.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security/advisories/new)
for this repository (Security tab → Report a vulnerability). This opens a
private draft advisory visible only to maintainers until a fix ships.

Include, where relevant:

- The affected file(s) or flow (e.g. key derivation, signing, approval
  window).
- Steps to reproduce, or a PoC.
- Impact — what an attacker could do (e.g. key exfiltration, signing without
  approval, draining funds).

## Scope

In scope: the extension itself (`apps/extension`), the core signing/vault
logic (`packages/core`), and the messaging contracts between them
(`packages/messaging`). Third-party dependency vulnerabilities are tracked
via Dependabot; if you find one that isn't already flagged in the Security
tab, reporting it here is still welcome.

## Response

We aim to acknowledge reports within a few days and to keep the reporter
updated as a fix is developed. Credit is given in the advisory unless you'd
rather stay anonymous.
