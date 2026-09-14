# Experience spec — flows and behavior

Compressed intake (authored core). Mined from the `ao-wallet` sibling
repo's `screens/TODO.md` (per-screen functionality/UX notes) and
`ARCHITECTURE.md §3` (surface behavior). No `DESIGN.md` — visual identity
(brand palette, typography, spacing) lives in the sibling repo's `brand/`
folder and its 16 built HTML mockups under `screens/`, consulted directly
by the ui layer rather than re-derived into a BMAD design doc.

## Surfaces

Four mounts of one shared component (`App({ layout, initialView })`):
**popup** (default, ~360–440px fixed width), **sidepanel** (tall flexible
column, persistent nav), **approval** (its own `chrome.windows.create`
window, opened for any connection or signing request — never inline in
the popup, since a popup closes on focus loss and would silently drop a
pending request), and **fullscreen** (Phase 2+, not built now). Surfaces
differ only in outer frame and a few affordances; everything below the
shell is shared.

## Risk-tiered confirmation (applies across every flow below)

Three tiers drive how much friction a screen imposes:
- **Routine** — no or light confirmation (composing a send, browsing
  activity).
- **Consequential** — one clear review screen, full address, neutral
  colors (a normal send/upload review, a connection request).
- **Irreversible** — explicit named-risk acknowledgment, the only tier
  allowed a warning-red accent (first-seen-address sends, unlimited
  grants, wallet removal with no backup, the "forgot password" reset).

State the specific consequence in plain language before anything else on
Consequential/Irreversible screens — never a generic "Are you sure?".

## Flow: Onboarding

1. Welcome screen (no wallet exists) — two choices, Create or Import, no
   network calls yet.
2. Create → set Vault password (10-char minimum, blocklist check,
   confirm-password field) → JWK generated client-side, encrypted
   immediately → backup/download prompt (explicit, skippable).
   Import → file drop or paste-JSON, validated against JWK shape before
   proceeding to the same password screen.
3. End state: wallet ready, guided to the main screen.

## Flow: Unlock

Reached whenever the wallet is currently locked: manual "Lock" action, an
opted-in auto-lock timeout elapsing, or first popup open after
install/browser restart. Single password field, single "Unlock" button,
no per-wallet identity shown. Wrong-password error is direct with a
next step, never an apology. A quiet "Forgot password?" link is always
present, leading to the destructive full-reset flow (Irreversible tier,
explicit confirmation naming exactly what gets wiped).

## Flow: Send AR

1. Recipient & amount (Routine) — address input (paste/scan), token
   picker (AR + AO tokens from balances), amount with max-button, inline
   address-format validation, no fee shown yet.
2. Review & confirm (Consequential, or Irreversible if first-seen
   address) — full untruncated address, amount, fee, total; state
   consequence first ("You're sending 12 AR to `<address>`. This can't be
   undone."); single primary action "Sign and send," no secondary
   distractions.
3. Success — optimistic local entry written immediately, pending state
   until gateway confirms, link out to ViewBlock.

## Flow: Receive

Single screen (Routine): QR code, full untruncated address, one-tap copy.
Dual-address type switcher deferred to Phase 2 (Ethereum keys).

## Flow: Tokens & activity

- All-tokens list and per-token detail (balance, USD value, scoped
  send/receive shortcuts, filtered activity) share the main screen's row
  style — no new visual language per list page.
- All-activity: merged local log + gateway query, most-recent-N,
  truncated addresses acceptable here (low-stakes glanceable list).
- Transaction detail: full untruncated tx id and tags, status
  (pending/confirmed/failed), ViewBlock link, decoded-data preview where
  applicable — the one place technical precision is shown in full.
- Empty states: one dry, understated line, no mascot/illustration beyond
  a simple geometric mark, never warning-red (empty isn't a problem
  state).

## Flow: Upload

1. Compose (Routine) — file/text/JSON input, live tag editor with a
   real-time byte-cap warning stating the actual byte count, optional UDL
   license tag picker.
2. Review & confirm (Consequential) — runs the pre-upload secret scan;
   a tripped scan overrides the primary action and states the specific
   match type plainly ("This looks like a private key. Uploads are public
   and permanent — remove it before continuing."); shows fee/cost and
   final tags.
3. Success — tx id, link to view uploaded content, link to ViewBlock.

## Flow: dApp connection request

Triggered by a page calling `connect()`. Shows origin and requested
permission scopes in plain nouns ("Bazar wants to: see your address, and
spend up to 50 AO. Nothing else."), approve/reject. A scope with no
spending limit escalates to Irreversible framing and says so explicitly.
Approve writes a Grant to per-origin permission storage.

## Flow: Signing approval

The highest-stakes screen. Opens in its own window for every
sign/dispatch/signDataItem/batchSignDataItem request from a connected
origin. Shows recipient, amount, fee, decoded-data preview, tags, and a
SHA-256 hash of the exact signing payload (its own copy affordance,
monospace). Maximum clarity, zero cleverness — state consequence first.
If no wallet exists yet when a request arrives, escalate to onboarding
in place and return to the pending request once onboarding completes,
rather than rejecting the dApp.

## Flow: Connected apps (settings)

Per-origin list of stored Grants with scope + expiry shown inline, and a
revoke action per row. Revoke must actually end all access the Grant
covered — never a soft "disconnect" that leaves prior approvals live.

## Flow: Wallet management

- Wallet switcher: list of stored wallets (address, name, method icon),
  switch active wallet, "add wallet" entry point back to onboarding's
  create/import choice.
- Settings home: plain list of rows (network/peers, auto-lock, connected
  apps, about/export) — sentence-case labels, no icon-only affordances.
- Network/peers: editable AO-Core/HyperBEAM peer list, add/remove,
  per-peer enable toggle, apply-to-switch-active-endpoint.
- Rename/remove wallet: rename is local-metadata-only; remove without a
  confirmed backup is Irreversible tier, naming the specific risk before
  proceeding.

## Cross-cutting states

- Network error/gateway unreachable: shared banner/inline state, direct
  next-step-first copy, no apology theater.
- Loading: skeleton placeholders matching eventual layout by default; a
  thin animated indicator only where truly unavoidable (e.g. a pending
  tx); respects `prefers-reduced-motion` with a static fallback
  everywhere.

## Reference material (not re-derived here)

16 built HTML mockups exist in the sibling repo under `screens/` — one per
flow above (`onboarding.html`, `unlock-screen.html`, `send-flow.html`,
`receive-screen.html`, `tokens-activity.html`, `upload-flow.html`,
`connection-request.html`, `signing-approval.html`,
`connected-apps.html`, `wallet-switcher.html`, `settings-home.html`,
`network-peers.html`, `wallet-detail.html`, `lock-settings.html`,
`cross-cutting-states.html`, plus shared tokens in `shared.css`). These
are visual/structural reference for the ui-layer build, consulted
directly rather than copied into this archive.
