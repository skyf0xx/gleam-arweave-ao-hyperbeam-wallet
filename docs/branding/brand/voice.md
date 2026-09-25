# Gleam — Brand Voice Guide

## 01 — Voice Overview

Gleam sounds like a sharp, unshowy engineer explaining exactly what's about to happen and why it's safe — not a security company reassuring you that it's safe. It talks the way well-made tools talk: plainly, specifically, and only when there's something worth saying. It never reaches for authority it hasn't earned through mechanics — no badges, no certifications-as-copy, no "trust us." It's light on its feet and occasionally lets a little dry warmth through, the way a beam of clean light is not a spotlight. Every sentence should feel like it could be backed up by something you can actually click into and verify.

**Voice Essence:** *Gleam sounds like a precise, unshowy engineer who respects your attention — clear, quietly confident, and allergic to reassurance theater.*

## 02 — Tone Dimensions

**Formality** — Casual ←●———→ Formal
- Sits closer to casual, but never sloppy. Contractions, plain words, short sentences — the register of a good technical README, not a legal disclosure.
- Example: *"Disconnecting an app revokes everything it could do. Not sometimes — always."*

**Energy** — Calm ●————→ Energetic
- Calm, deliberately. Gleam is the wallet that doesn't need to hype you up before a transaction. Energy shows up as precision, not exclamation points.
- Example: *"This grant lets Bazar spend up to 50 AO, until you revoke it."*

**Humor** — Serious ●———→ Witty
- Mostly serious with a dry, occasional wink — "almost playful," never jokey. Humor never appears near money-moving or security-critical moments.
- Example (safe moment, e.g. empty state): *"Nothing here yet. Send yourself something to test the waters."*

**Expertise** — Accessible ●————→ Authoritative
- Accessible without dumbing down. Gleam assumes an intelligent reader who may be new to AO/Arweave specifically, not new to computers. Explain mechanism, don't hide it behind reassurance.
- Example: *"This is a one-time approval for 12 AO — it expires after this transaction."*

**Warmth** — Distant ←——●—→ Intimate
- Warm but not familiar. No forced friendliness, no "hey friend!" — respect shown through clarity, not chumminess.
- Example: *"Your recovery method hasn't been tested. Verify it now — it takes under a minute and won't move any funds."*

## 03 — Voice Qualities

**Plain-spoken**
Say exactly what happens, in the order it happens, with no euphemism. A signing request is a signing request, not an "authorization event."
- **Do:** "This app can see your balance and address. It cannot move funds without a separate approval."
- **Don't:** "By proceeding, you acknowledge and grant the requesting application certain permissions."

**Mechanically confident, never asserted**
Trust is demonstrated (simulation, revocation, full addresses) — never claimed in adjectives.
- **Do:** "Every address is shown in full. Nothing here is truncated."
- **Don't:** "Bank-grade security you can trust."

**Proportional**
Language weight matches actual risk. Routine actions get quiet, minimal copy; irreversible or high-stakes actions get direct, unambiguous language — never the same modal tone for both.
- **Do:** (routine) "Signed and sent." / (high-risk) "This grant has no spending limit. Most apps don't need this."
- **Don't:** "Are you sure?" on every single action regardless of stakes.

**Specific over hollow**
Numbers, scopes, and durations replace vague reassurance every time they're available.
- **Do:** "Expires in 24 hours or after 3 uses, whichever comes first."
- **Don't:** "This is a safe, limited-time permission."

**Quietly humane**
Errors and recovery moments are handled like a competent person helping you, not a legal department or a cheerful bot.
- **Do:** "That password didn't unlock this wallet. Try again, or use your recovery method."
- **Don't:** "Oops! Something went wrong on our end. 😅"

**Small footprint**
Copy is as light as the product claims to be — no filler sentences, no throat-clearing before the point.
- **Do:** "Grant expired. Reconnect to continue."
- **Don't:** "We wanted to let you know that unfortunately, it looks like the grant for this application may have expired."

## 04 — Vocabulary

**Words we use:**
grant, revoke, scope, expires, preview, simulate, verify, capability, connected apps, active address, watch-only, recovery, passkey, plain-language, counterparty, full address, audit, export, one-time, budgeted

**Words we avoid:**
bank-grade, military-grade, enterprise-grade, revolutionary, seamless, empower, seamlessly, best-in-class, cutting-edge, next-gen, ecosystem (as filler), leverage (as a verb), robust, world-class, game-changing, disrupt

**Brand-specific language:**
- "Grant," not "connection" or "approval," for a scoped permission an app holds.
- "Revoke," never "disconnect," for the action that actually ends access — if the UI still says "disconnect," it must behave like revoke.
- "Wallet," not "account," when referring to a keypair/identity; "address," not "wallet address" (redundant).
- Refer to the person using the product as "you," never "the user" in-product; "users" is fine only in internal/strategy docs.
- "Simulate" / "preview," not "estimate," for showing transaction consequence before signing.

## 05 — Writing Style Rules

**Sentence length:** Short by default. Mix in one longer sentence only when explaining a mechanism that genuinely needs the subordinate clause (e.g. what a grant covers and for how long). Never stack two long sentences back to back.

**Punctuation:** Em-dashes used sparingly for a beat, not a crutch. No ellipses. Exclamation marks essentially banned — reserve for genuine, rare delight (e.g. successful recovery test), never for routine confirmations or errors.

**Capitalization:** Sentence case everywhere, including buttons and headers ("Verify recovery," not "Verify Recovery"). No ALL CAPS for emphasis — use word choice instead.

**Numbers:** Numerals for anything quantitative or transactional (amounts, counts, durations: "3 uses," "24 hours," "12 AO"). Spell out only small non-quantitative numbers in prose ("a one-time grant").

**Contractions:** Always use them ("don't," "won't," "it's") — full forms read as stiff and corporate here.

**Active vs. passive voice:** Active, almost without exception. Passive voice is the tell of reassurance-without-mechanism ("your funds are protected" vs. "you hold the only key that can move these funds").

**Humor:** Allowed only in low-stakes, non-financial, non-security contexts (empty states, onboarding flourishes). Dry and brief — one line, never a bit. Never near a signing screen, an error involving funds, or a security setting.

## 06 — Channel Adaptations

| Channel | Tone Adjustment | Example |
|---|---|---|
| Extension UI (popup/side panel/full page) | Tightest, most literal. Every word earns its place — this is read under time pressure. | "This lets Bazar spend up to 50 AO. Expires in 7 days." |
| Approval / signing screens | Maximum clarity, zero cleverness. Consequence stated before anything else. | "You're sending 12 AR to 0x4f2a…9cd1. This can't be undone." |
| Onboarding | Slightly warmer, slightly more narrative — still short. Can explain *why*, once. | "No seed phrase to write down yet. Add one later, whenever you want." |
| Website / marketing | Same voice, more room to breathe — can use a full paragraph to make one point. Still no hype words. | "Gleam shows you what a signature actually does before you make it." |
| Error messages | Direct, specific, next-step-first. No apology theater. | "Wrong password. Try again, or start recovery." |
| Support / help content | Most patient and explanatory register the voice allows — still plain, no jargon left unexplained. | "A grant is what an app is allowed to do — not what it's connected to. You can narrow or revoke it anytime." |

## 07 — Before and After

**Before:**
> "By connecting your wallet, you agree to grant this application the permissions it has requested in accordance with its integration requirements."

**After:**
> "Bazar wants to: see your address, and spend up to 50 AO. Nothing else."

**Why it works:** States exactly what's granted, in plain nouns and numbers, instead of legal-sounding abstraction.

---

**Before:**
> "🎉 Congrats! Your wallet is all set up and ready to go! You're now part of the Gleam family."

**After:**
> "Wallet ready. Here's how to send your first transaction."

**Why it works:** Drops false enthusiasm and a manufactured sense of belonging; moves straight to the next useful action.

---

**Before:**
> "Are you sure you want to proceed with this action? This action cannot be undone."

**After:**
> "You're sending 200 AR to an address you haven't used before. This can't be undone."

**Why it works:** Same friction level reserved for something actually irreversible — but it tells you the specific fact (new address, amount) instead of a generic warning that trains people to click through.

---

**Before:**
> "Your security is our top priority. We use industry-leading encryption to keep your assets safe."

**After:**
> "Your key is encrypted on your device and never leaves it. We can't see it, and neither can anyone else."

**Why it works:** Replaces a trust claim with a mechanism you can actually verify.

---

**Before:**
> "Oops! We couldn't process your request at this time. Please try again later."

**After:**
> "Couldn't reach the network. Retrying — or check your connection and try again."

**Why it works:** Says what actually happened and gives a concrete next step instead of a vague apology.

## 08 — Things We Never Say

- Hollow hype: "revolutionary," "game-changing," "seamless," "best-in-class," "next-gen"
- Trust-by-assertion: "bank-grade security," "military-grade encryption," "you can trust us," "industry-leading"
- Manufactured urgency: "act now," "limited time," "don't miss out" — Gleam has no engagement mechanics and no reason to pressure
- Uniform friction: the same "Are you sure?" on every action regardless of actual stakes
- Cheerful-bot error language: "Oops!", excessive emoji, apology-as-filler ("We're so sorry for the inconvenience!")
- Belonging/community language for a wallet: "family," "tribe," "join the movement"
- Euphemism for what's actually happening: "authorization event" for "signature," "engagement" for "usage," "optimize your experience" for anything
- Truncated addresses in confirmation copy or examples — always show the full address, in every context, including marketing screenshots
