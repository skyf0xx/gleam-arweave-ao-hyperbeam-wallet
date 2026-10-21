# Security Policy

Gleam is a browser-extension wallet holding user private keys. Please report
vulnerabilities privately rather than through a public GitHub issue.

How Gleam protects keys, what it defends against, its by-design
trade-offs and its known limitations are in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). The files
in scope for a security review are listed in
[security/surface.txt](security/surface.txt).

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

If the report comes from a [community scan](SCANS.md), include its
attestation id as a line of its own, `Attestation id: <64 hex characters>`,
so the finding is credited to the wallet that signed the scan.

## Severity

A maintainer sets the severity of each confirmed report by what was
shown under realistic conditions, not the worst case imaginable.

- **Critical**: a malicious website or network attacker, with nothing
  from the user beyond ordinary use, gets the key or a signature or
  transfer the user never approved, on default settings.
- **High**: a named control is fully defeated with real consequences.
  For example: the approval preview shows a different transaction from
  the one signed; a signature needs only one plausible click on a
  misleading prompt; the key reaches a page, a log or
  `chrome.storage.local`; the wallet stays unlocked after auto-lock.
- **Medium**: a real boundary violation with a limited blast radius or
  uncommon preconditions. For example: a page learns the address without
  a connect approval; the preview hides a material field only for an
  unusual transaction shape.
- **Low**: disclosure of non-secret internals, an effect that takes
  sustained effort for little gain, or a docs mismatch.
- **Informational**: true, but with minimal impact on its own.

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
