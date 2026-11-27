# Security Policy

Gleam is a wallet for Arweave and AO. It ships as a Chrome extension and
an iOS and Android app, and it holds private keys. Report vulnerabilities
privately.

- How Gleam protects keys, and its trade-offs and limits:
  [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- Files in scope for a security review:
  [security/surface.txt](security/surface.txt)
- How Gleam is built and released:
  [docs/SECURITY_PRACTICES.md](docs/SECURITY_PRACTICES.md)
- How reports and incidents are handled:
  [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md)

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/security/advisories/new)
(Security tab → Report a vulnerability). Without GitHub, email
<kawess@gmail.com>.

The [report form](.github/VULNERABILITY_REPORT.yml) accepts Medium and
above. A report sent through the API uses the form's labels as
`### <label>` headings.

If you signed a [community scan](SCANS.md), add its attestation id. Any
attestation your wallet signed counts.

## Severity

Severity follows what the report shows under realistic conditions. Each
report answers three questions:

1. **Attacker:** one row of
   [THREAT_MODEL.md § Attackers](docs/THREAT_MODEL.md#attackers).
2. **Loss:** pick one.
   - `key`: the private key or the vault password leaves the wallet.
   - `unapproved`: a signature or transfer the user never approved.
   - `mismatch`: the preview shows a different recipient, amount, asset
     or authority from the one signed, or leaves one out. A correct value
     that is easy to misread, such as a lookalike name, is `none`.
   - `control`: a control the user set stops holding, such as a revoked
     site, the auto-lock or a passkey removal.
   - `disclosure`: a site learns an address or other data without the
     user's consent.
   - `lockout`: the wallet can't sign or unlock until the user acts.
   - `none`: none of these.
3. **Requires:** what has to happen beyond ordinary use.
   - `none`: nothing.
   - `one-click`: one approval of a prompt that looks normal.
   - `unusual`: a setting few users have, or a condition the attacker
     doesn't control, such as a browser restart. A malicious site sends
     any request shape it likes, so a request's shape is ordinary.
   - `rare`: a one-time coincidence the attacker can't cause or retry,
     such as the worker stopping between two steps.

| Loss | Requires none | one-click | unusual | rare |
| --- | --- | --- | --- | --- |
| `key` | Critical | High | Medium | Medium |
| `unapproved` | Critical | High | Medium | Low |
| `mismatch`, `control` | High | High | Medium | Low |
| `disclosure`, `lockout` | Medium | Medium | Low | Low |
| `none` | Low | Low | Low | Low |

A docs mismatch, missing defence in depth or disclosure of non-secret
internals is `none`. Medium and above earns a share of the bounty pool
([SCANS.md § Points](SCANS.md#points)).

## Scope

In scope:

- The extension (`apps/extension`), the iOS and Android app
  (`apps/mobile`) and every package they ship (`packages/`).
- The release pipeline (`.github/workflows/release.yml` and the release
  scripts in `scripts/`).
- Gleam's handling of a hostile gateway or AO node response.
- The vault backup's encryption, key wrapping, passkey wrapping and
  password policy.
- A dependency vulnerability the Security tab hasn't flagged.

Out of scope:

- Bugs in Chrome, iOS, Android or hardware wallet firmware. Report those
  to the vendor.
- The gateways and AO nodes themselves, such as `arweave.net` and
  `ao-testnet.xyz`.
- [THREAT_MODEL.md § Out of scope](docs/THREAT_MODEL.md#out-of-scope),
  such as a compromised device.
- Traffic-volume denial of service, spam, social engineering and
  physical access.
- Findings that appear only in a development build.

Fixes ship in the latest release.

## Safe harbor

Good-faith research under this policy is authorized. Gleam won't take or
support legal action against you for it. Good faith means you:

- test only with wallets, devices and accounts you own;
- leave other people's funds and data alone;
- keep gleamwallet.app and the Points server working for others;
- keep the report private until its advisory is published.

If someone else takes legal action against you for such research, we
will say publicly that it was authorized.

## Disclosure

- A Low finding is published once its fix merges.
- A Medium or higher finding is published once the release with its fix
  is live.
- If neither has happened 90 days after your report, you may publish.
  Please give us a week's notice.

## Response

| Step | Within |
| --- | --- |
| First reply | 3 business days |
| Reproduced and rated, or closed with the reason | 10 business days |
| Fix released: Critical | 7 days of the rating |
| Fix released: High | 30 days |
| Fix released: Medium | 60 days |
| Fix released: Low | The next release |

We update you at least every two weeks until the advisory is published,
and can ask you to check the fix before it ships. The advisory credits
you unless you ask to stay anonymous.
