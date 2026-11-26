# Incident response

What happens after a vulnerability report, and what to do when part of
Gleam's supply chain or infrastructure is compromised. How to report is
in [SECURITY.md](../SECURITY.md). The attackers each step answers to are
in [THREAT_MODEL.md § Attackers](THREAT_MODEL.md#attackers).

Gleam has one maintainer, who handles every report and incident below.

## Vulnerability reports

Each report stays a private draft advisory in the repository's Security
tab from the first reply to publication. The advisory is the record:
every step below is a comment or an edit on it.

1. **Acknowledge** the report and say what happens next.
2. **Reproduce** it against the current release and `master`. Ask the
   reporter for what's missing rather than guessing.
3. **Rate** it with [SECURITY.md § Severity](../SECURITY.md#severity),
   and tell the reporter the rating and why. Close a report that doesn't
   reproduce or rates `none`, with the reason.
4. **Fix** it on a branch, with a test that fails before the fix. Until
   the release ships, commit messages and the PR describe the behaviour
   change only, never the attack.
5. **Verify** the fix with the reporter before release, when they are
   willing.
6. **Release** within the times in
   [SECURITY.md § Response](../SECURITY.md#response). A Low fix ships
   with the next release; a higher one gets its own release if the next
   one wouldn't meet them.
7. **Publish** the advisory with credit to the reporter: a Low one once
   the fix is merged, a Medium or higher one once the release with the
   fix is live. Its summary says who is affected, what they lose and
   which version fixes it.
8. **Tell users** when they have to act, through the channels below.

## Incidents

An incident is a compromise of something Gleam runs or ships through,
not a bug in its code. For each kind, the first moves are below. Then
work through § After an incident.

### Malicious code in a release

A compromised dependency, Action or build that reached users.

1. Stop the rollout: publish a fixed version to the Chrome Web Store, or
   unpublish the item if a fix will take more than a few hours. Pull the
   APK from the download page and set `apps/site/latest.json` to the
   fixed version. Expire the TestFlight build.
2. Post a critical notice in `apps/site/announcements.json`. Open wallets
   pick it up within an hour.
3. If the code could have asked the wallet to sign while it was
   unlocked, tell users to move their funds to a new wallet. An unlocked
   key can't be copied, but it can be used.
4. Find how it got in: the lockfile diff, the Dependabot PR, the
   workflow run and its attestation.

### A leaked signing key or store credential

The CRX signing key, the App Store Connect API key, the Play service
account key, the Android upload keystore or the gleam-triage App key.

1. Revoke it where it was issued: the Chrome Web Store developer
   dashboard, App Store Connect → Integrations, Google Cloud IAM, Play
   Console's upload key reset, or the GitHub App settings.
2. Check each store for builds or listing changes you didn't make.
3. Issue a new key and store it only in the KeePassXC database.
4. Treat the machine it leaked from as compromised until shown
   otherwise.

### A compromised GitHub account, repository or CI

1. Revoke sessions, SSH keys and tokens on the account, and check its
   security log.
2. Compare `.github/allowed_signers`, the rulesets and the workflows
   with the last known-good commit.
3. Check that every recent tag is signed by an allowed key and that each
   release's zip matches its attestation (`gh attestation verify`).
   Delete any release that doesn't, and warn users who installed it.

### A compromised website or DNS

gleamwallet.app can show announcements and send the wallet the site
messages listed in the threat model, but it can't sign transactions.

1. Take the site down in Vercel, or point DNS at a static holding page.
2. Check Cloudflare for DNS changes, and the Vercel project for deploys,
   members and environment changes.
3. Post on [x.com/gleam_wallet](https://x.com/gleam_wallet) that the
   site isn't to be trusted until further notice, since the in-wallet
   notice comes from the site itself.

### A breach of the Points server or database

The database holds wallet addresses and public keys, device ids,
invite codes, Points balances and scan attestations. It holds no
private key, password, email or name.

1. Rotate `DATABASE_URL` and the server's `GITHUB_TOKEN` in Railway.
2. Read the Railway logs for the access, and check the tables for
   changed balances or awards.
3. Tell users which addresses and device ids were exposed, since they
   link a person's wallets together.

## Telling people

| Channel | Reaches |
| --- | --- |
| A critical notice in `apps/site/announcements.json` | Every open wallet, within an hour |
| The published GitHub advisory | dApp developers and anyone watching the repository |
| The GitHub Release notes of the fixed version | Anyone verifying or updating by hand |
| [x.com/gleam_wallet](https://x.com/gleam_wallet) | Followers, and users when the site is down |

Say what happened, who is affected, what they should do and which
version fixes it. If the incident exposed personal information, check
whether the privacy law that applies to Gleam's operator requires
reporting it to a regulator, and do so.

## After an incident

1. Write up what happened, how it was found, what was exposed and what
   changed, and publish it as an advisory or a release note.
2. Add a test or check that would have caught it.
3. Update [THREAT_MODEL.md](THREAT_MODEL.md) if an attacker, a defence or
   a limitation changed.
