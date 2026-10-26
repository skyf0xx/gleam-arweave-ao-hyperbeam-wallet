# What to look for in a Gleam scan

This is the checklist for Steps 4 and 5 of `security/scan/SKILL.md`. It
says where to look and what to ask. It doesn't decide what counts as a
finding. `security/scan/VERIFY.md` does that.

Every item is a question. A "yes, it does that" is a lead, not a finding.
Follow it until you can say whether it is safe, then put each lead you
can't settle through `VERIFY.md`.

The sections run in the order you use them:

1. **By area**: the security surface (`security/surface.txt`), grouped
   by what a bug there would break. Use it in Step 4.
2. **Across areas**: classes of bug that cut across files. Use them in
   Steps 4 and 5.
3. **Wildcard**: questions for the code nobody pointed you at. Step 5.
4. **Obvious things**: a literal list to check once. Step 5.
5. **What the tests don't test**. Step 5.

Some of the classes here are adapted from Cloudflare's
[security-audit-skill](https://github.com/cloudflare/security-audit-skill)
(MIT).

## 1. By area

### Key material (tier 1)

`core/signer/`, `core/vault/`, `core/keys/`, `handlers/key-session.ts`,
`src/keyring/`, `entrypoints/keyring/`, `adapters/offscreen-keyring.ts`.

- Where does the decrypted key live while the wallet is unlocked? Does
  it ever reach `chrome.storage.local`, a message to a page, an error
  message or a log?
- Are byte buffers zeroed after use, and on every error path
  (`zeroize.ts`)? A JS string can't be zeroed, so a key held as a string
  is worth noting.
- Which contexts does the offscreen keyring accept a port from, and what
  does it check before it answers?
- When a crypto call throws, what does the caller do? Is there any path
  that falls back to a weaker method or to no encryption at all?

### Locking (tier 1)

`handlers/key-session.ts`, `enforceAutoLock`, `adapters/session-access.ts`.

- Does the auto-lock alarm really remove the keys?
- When the service worker or the offscreen document restarts
  mid-session, does the wallet come back unlocked when it should be
  locked?
- `chrome.storage.session` is limited to trusted contexts
  (`setAccessLevel`). Is that call made before anything is written, and
  on every start path?
- What survives a lock, a wallet switch or removing a wallet: cached
  keys, pending approvals, connected-site grants, in-flight requests?

### Passkey unlock (tier 1)

`core/vault/passkey.ts`, `handlers/passkey.ts`, `src/passkey/`,
`entrypoints/passkey/`.

- The PRF output wraps the vault password. Is the wrapped value bound to
  this wallet and this credential, or can one wallet's wrap be replayed
  against another?
- Can a page open `passkey.html`, or drive a ceremony the user didn't
  start?

### Signing pipelines (tier 2)

`core/arweave/`, `core/ao/transfer.ts`, `handlers/transfer.ts`,
`handlers/upload.ts`.

- Is what gets signed exactly what was approved? Look for any
  re-serialization, default filled in, or field rewritten between the
  approval and the signature.
- Amounts are atomic-integer strings. What happens with a negative
  value, leading zeros, an exponent, a decimal point, whitespace or a
  value beyond 2^53?
- Is the recipient or target validated as an Arweave address before
  signing? Can a data item's tags change who or what the item is for?

### Crypto (tiers 1 and 2)

`core/signer/envelope.ts`, `core/arweave/rsa-pss.ts`.

- What are the Argon2id parameters and their bounds? Can a stored
  envelope force weaker parameters? Is there any fallback to a weaker
  KDF?
- Is the AES-GCM nonce fresh for every encryption? Is the RSA-PSS salt
  length the one Arweave expects?

### Provider bridge (tier 3)

`packages/provider/`, `entrypoints/provider/`, `entrypoints/content/`,
`packages/messaging/src/page-protocol.ts`.

- The `event.source` check, per-request ids, the `settled` flag,
  timeouts, and decoding of binary values.
- Does every page-supplied value have a size limit before it is parsed,
  stored or shown?
- Can one page's response reach another page, or another frame of the
  same page?

### Dispatch (tier 3)

`packages/runtime/src/dispatch/methods.ts`, `packages/runtime/src/dispatch/site.ts`,
`apps/extension/src/sender.ts`, `packages/core/src/policy/signing-origin.ts`,
`packages/runtime/src/handlers/provider-params.ts`.

- Each method's caller tier, and whether it can open an approval.
- Does any method's zod schema accept something its handler doesn't
  expect: extra keys, a wider type, a value the handler then trusts?
- Can any method that signs or reveals something run without an
  approval?
- Does the origin come from Chrome's `sender`, never from the message
  body, on every path?

### Approval window: what you see is what you sign (tier 4)

`handlers/approval.ts`, `entrypoints/approval/`, `packages/app/src/approval/`.

- Is the preview decoded from the same bytes that get signed, or from a
  summary the page supplied?
- Can a long, multi-line, right-to-left or look-alike value push a
  material field out of view, or make one field look like another?
  Check truncation, wrapping and where the preview cuts off.
- With two requests open at once, can approving one answer the other?
  Is each approval bound to its own request id?
- Can a page close, replace, cover or race the window? Can it get the
  approve button clicked by stealing focus as the window opens?
- Can an approval be used twice, or replayed after it was answered?
- Values that come from the network, such as token names, logos and
  decimals, are under a lying gateway's or AO unit's control. Can any
  of them change the amount or recipient the preview shows?

### Hardware wallet signing

`packages/keystone/src/`, `apps/extension/src/hardware/panels/`.

- Is the signature the device returns checked against the request that
  was sent before Gleam uses it?
- Can a QR frame from a different request be mixed into this one?

### Permissions and manifest (tier 5)

`wxt.config.ts`.

- `optional_host_permissions` is `https://*/*`. Does every runtime host
  request ask for exactly the host the user typed, show it, and validate
  it (`packages/app/src/screens/network-peers/`)?
- What does each `web_accessible_resources` entry let a page load or
  learn?
- `externally_connectable` lets the Gleam site message the extension.
  What can a message from that origin do, and does a development-only
  entry ever reach a production build?

### CSP (tier 5)

`src/csp.ts`.

- What does `wasm-unsafe-eval` allow? Is any directive missing?
- Can the looser dev policy reach a production build?

### CI and release (tier 5)

`.github/`, `pnpm-workspace.yaml`, the release scripts.

- Does any workflow run on `pull_request_target`, or put an untrusted
  value such as `${{ github.event.pull_request.title }}` straight into a
  `run:` script?
- Are third-party actions pinned to a commit sha?
- Which secrets can a workflow triggered from a fork reach?
- Can a dependency update merge, or a release build, without the checks
  the threat model says it gets?

## 2. Across areas

**Message trust.** Every handler of `postMessage`,
`runtime.onMessage`, `runtime.onMessageExternal` or a port: does it check
the exact origin (not a prefix, suffix or unanchored regex), the expected
`event.source` or `sender.frameId`, and that the sender is the context it
expects? On the send side, does anything sensitive go out with target
`*`?

**Prototype pollution.** Page-supplied JSON with a `__proto__` or
`constructor` key: does it reach a recursive merge, path assignment or
`Object.assign` onto a shared object? It matters only if a later read of
the polluted property changes a security decision. Name that gadget.

**DOM and navigation injection.** Does any page-, network- or
announcement-supplied string reach `dangerouslySetInnerHTML`,
`innerHTML`, an `href` or `src`, or `window.open`? Can a `javascript:` or
`data:` URL get through? React escapes text; check the escape hatches.

**State machines and races.** The service worker can be stopped between
any two `await`s. For each multi-step flow (unlock, approve, sign,
send): can a step be skipped, repeated or run out of order? What happens
when the wallet locks while a signature is in flight? Is any
check-then-act split across an `await`, so the state can change between
the check and the act?

**Encoding and limits.** base64url versus base64, BigInt parsing, tag
encoding, JSON depth and size. Do two parts of the code decode the same
value differently? Is each size limit enforced before the expensive
work, not after?

**Trusting stored data.** Data read back from `chrome.storage` is
treated as already validated. Can a different code path, an older
version's format, or a migration write something the reader doesn't
expect?

**Error and fallback paths.** What is the security posture when a fetch
fails, a feature flag is off, a setting is missing or a migration is half
done? Does an error message echo a key, a password or a page-supplied
value back to a page?

**Lying network.** The threat model treats gateways, AO units and price
APIs as able to lie. Does any value they return feed a signing decision,
the approval preview, or a URL the extension then opens?

**Development leaks.** `import.meta.env.DEV`, `mode === 'development'`
and `command === 'serve'` branches: can any of them reach a production
build?

## 3. Wildcard

For the code no checklist points at:

- What is the strangest code in the repository? Why does it exist? What
  happens if a page abuses it?
- Which features look half-finished, experimental or bolted on? They had
  the least review.
- What can a page send that the Gleam UI never would? The UI constrains
  the user; the message protocol doesn't.
- What happens when features that weren't designed together meet:
  passkey unlock and auto-lock, hardware signing and dApp approvals,
  points and the site bridge?
- Where a comment explains why something is safe, check the
  explanation.
- What does the git history show? Look for reverted security fixes and
  removed checks: `git log -p -S '<symbol>' -- <file>`.
- Which actions can't be undone (a send, a key export, removing a
  wallet)? Is the confirmation bound to that exact action and wallet?

## 4. Obvious things

Check each once, literally. Each hit still needs its full path traced
before it is a finding.

- Hardcoded secrets: `password`, `secret`, `apikey`, `token`, `Bearer`,
  `-----BEGIN`. Committed `.env`, `*.pem` or `*.key` files.
- `TODO`, `FIXME`, `HACK` or `XXX` comments that mention security,
  validation or auth.
- `eval`, `new Function`, or a dynamic `import()` with a computed path.
- `console.*` calls that can print a key, a password or a decrypted
  value.
- Manifest permissions the code doesn't use.
- Plain `http://` URLs outside loopback and tests.

This search finds the leads for this section and Section 2:

```bash
git grep -nE '__proto__|Object\.assign|dangerouslySetInnerHTML|javascript:|onMessageExternal|onConnectExternal|externally_connectable|setAccessLevel|new Function|eval\(|console\.(log|error|warn)' -- '*.ts' '*.tsx' '*.js' '*.mjs' ':!*.test.ts' ':!*.test.tsx'
```

It prints about 50 lines.

## 5. What the tests don't test

Each surface file has tests next to it (`foo.ts` → `foo.*.test.ts`).
Compare the cases they cover with the ones they don't. An input shape,
error path or ordering with no test is a good place to write your own
throwaway test (Step 5 of `SKILL.md`).
