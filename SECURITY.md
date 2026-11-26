# Security Policy

Gleam is a wallet for Arweave and AO, shipped as a Chrome extension and
an iOS and Android app, that holds user private keys. Please report
vulnerabilities privately rather than through a public GitHub issue.

How Gleam protects keys, what it defends against, its by-design
trade-offs and its known limitations are in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). The files
in scope for a security review are listed in
[security/surface.txt](security/surface.txt). How Gleam is built and
released is in [docs/SECURITY_PRACTICES.md](docs/SECURITY_PRACTICES.md),
and how reports and incidents are handled is in
[docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md).

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security/advisories/new)
for this repository (Security tab → Report a vulnerability). This opens a
private draft advisory visible only to maintainers until a fix ships.

The report form ([`.github/VULNERABILITY_REPORT.yml`](.github/VULNERABILITY_REPORT.yml))
asks for a summary, the answers to the three questions under Severity,
the function a fix has to change, a failing test and the details. It
accepts only Medium and above. A report through the API carries the same
sections, as `### <label>` headings in its description.

If you have signed a [community scan](SCANS.md), put its attestation id
in the form's Attestation id field, so the finding is credited to the
wallet that signed the scan. Any attestation your wallet signed works,
not only the one from the round that found the issue.

## Severity

A maintainer sets the severity of each confirmed report by what was
shown under realistic conditions, not the worst case imaginable. Every
report answers three questions, and the answers set the severity.

1. **Attacker:** who does it. One row of
   [THREAT_MODEL.md § Attackers](docs/THREAT_MODEL.md#attackers), such as
   a malicious website or someone at an unlocked browser.
2. **Loss:** what the user loses. Pick one:
   - `key`: the private key or the vault password leaves the wallet.
   - `unapproved`: a signature or transfer the user never approved.
   - `mismatch`: the user approves one thing and signs another. The
     preview shows a different recipient, amount, asset or authority
     from the one signed, or leaves one out. A value shown correctly but
     easy to misread, such as a lookalike name or a truncated one whose
     full value is a click away, is `none`.
   - `control`: a control the user set stops holding, such as a revoked
     site, the auto-lock or a passkey removal.
   - `disclosure`: a site learns an address or other data without the
     user's consent.
   - `lockout`: the wallet can't sign or unlock until the user acts.
   - `none`: none of these.
3. **Requires:** what has to happen beyond ordinary use.
   - `none`: nothing.
   - `one-click`: one approval of a prompt that doesn't look wrong.
   - `unusual`: an action or setting few users have, or a condition the
     attacker doesn't control, such as a browser restart. The shape of a
     request is not unusual: a malicious site sends any shape it likes.
   - `rare`: a coincidence at one moment that the attacker can neither
     cause nor retry, such as the worker stopping or a storage write
     failing between two steps, or a clock set by hand. If the attacker
     can repeat the attempt until the timing works, it is not rare.

| Loss | Requires none | one-click | unusual | rare |
| --- | --- | --- | --- | --- |
| `key` | Critical | High | Medium | Medium |
| `unapproved` | Critical | High | Medium | Low |
| `mismatch`, `control` | High | High | Medium | Low |
| `disclosure`, `lockout` | Medium | Medium | Low | Low |
| `none` | Low | Low | Low | Low |

Severity weighs how bad the loss is against how often it can happen. A
leaked key can't be undone, so even a rare path to one earns Medium.

Only Medium and above earns a share of the bounty pool
([SCANS.md § Points](SCANS.md#points)). A docs mismatch, missing
defence in depth, or disclosure of non-secret internals is `none`.

## Scope

In scope: the extension (`apps/extension`), the iOS and Android app
(`apps/mobile`), every package they ship (`packages/`), and the release
pipeline that builds them (`.github/workflows/release.yml` and the
release scripts in `scripts/`). Third-party dependency vulnerabilities
are tracked via Dependabot; if you find one that isn't already flagged
in the Security tab, reporting it here is still welcome.

Out of scope:

- Bugs in Chrome, iOS, Android or a hardware wallet's firmware. Report
  those to their vendor.
- Arweave gateways and AO nodes Gleam talks to, such as `arweave.net`
  and `ao-testnet.xyz`. Gleam's handling of a hostile response is in
  scope.
- Everything under [THREAT_MODEL.md § Out of scope](docs/THREAT_MODEL.md#out-of-scope),
  such as a compromised device or another extension that can read pages.
- Denial of service by traffic volume, spam, social engineering and
  physical access.
- A finding that only a development build shows.

## Supported versions

Fixes ship in the latest release.

## Safe harbor

Research done in good faith under this policy is authorized, and Gleam
won't take or support legal action against you for it. Good faith means
you:

- test only with wallets, devices and accounts you own;
- never move, read or keep anyone else's funds or data;
- don't degrade gleamwallet.app or the Points server for other people;
- keep the report private until its advisory is published.

If someone else takes legal action against you for research that
followed this policy, we will say publicly that it was authorized.

## Disclosure

Please don't share a report with anyone until its advisory is published.
We publish a Low finding once its fix is merged, and a Medium or higher
one once the release with its fix is live. If that hasn't happened 90
days after your report, you may publish your findings, and we'd ask for
a week's notice first.

## Vault backup

The optional vault backup is one file in the user's own Google Drive app
folder, or iCloud on iOS. It is encrypted under a random key, and that key
is stored beside it wrapped under the vault password with Argon2id. Where
an install has a passkey, the file's header also carries the vault
password wrapped under that passkey's PRF output, so a restore can use the
passkey; only the authenticator can compute that key. Google and Apple
hold ciphertext they cannot read, Gleam runs no server and holds nothing,
and the password or a passkey that wraps it is the only key to the file.
Someone who takes over the account gets an offline guess at the password,
so a report that weakens the password policy, the key wrapping, the
passkey wrapping or the file's encryption is in scope.

## Response

| Step | Within |
| --- | --- |
| First reply | 3 business days |
| Reproduced and rated, or closed with the reason | 10 business days |
| Fix released: Critical | 7 days of the rating |
| Fix released: High | 30 days |
| Fix released: Medium | 60 days |
| Fix released: Low | The next release |

You'll hear from us at least every two weeks until the advisory is
published, and we'll ask you to check the fix before it ships if you'd
like to. Credit is given in the advisory unless you'd rather stay
anonymous. Paid awards for Medium and higher findings are set out in
[SCANS.md § Points](SCANS.md#points).
