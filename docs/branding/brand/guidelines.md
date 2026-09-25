# Gleam — Brand Guidelines

### About This Guide

This is the single reference for how Gleam looks, sounds, and talks about itself — for anyone designing a screen, writing copy, or representing the brand externally, without needing to ask. It consolidates the brand's strategy, visual identity, and voice into one usable standard. When something isn't covered here, default to the underlying principle: restraint over decoration, mechanism over claim, friction proportional to risk.

---

## Part 1 — Brand Foundation

Gleam is a lightweight crypto wallet built around simplicity, clarity and precision. These guidelines define how Gleam should look, sound and behave across the browser extension, website, product UI, marketing, social media and future brand applications.

> When in doubt, choose less.

### Brand Essence

#### Mission

Make interacting with crypto feel simple, clear and lightweight.

#### Vision

A crypto wallet that feels less like financial infrastructure and more like excellent everyday software.

#### Values

- **Simple** — Remove complexity rather than exposing it.
- **Precise** — Every interaction, word and visual element should have a reason.
- **Lightweight** — Small footprint, fast interaction, minimal cognitive load.
- **Transparent** — Make important information visible and understandable.
- **Independent** — Technical and capable without corporate heaviness.

### Brand Personality

Clean. Precise. Light. Technical. Effortless — with one release valve: empty states may carry a single dry, understated line of personality. Nowhere else (never on a signing screen, an error, or a security setting).

### Brand Archetype

**Sage** (primary), with **Creator** as a secondary influence.

Sage shows up as the drive to make things understandable and to tell the truth plainly — no badge language, no euphemism for what a signature or a grant actually does, trust earned through legible mechanics rather than asserted through reassurance copy. Creator shows up in the exactingness of the execution — the beam as a designed signature, the formula-driven system in Part 7, the instinct to remove rather than decorate. Gleam is not Ruler (no authority-through-scale claim), not Magician (no transformation promise), and not Jester (personality is rationed to a single release valve, never a running bit).

### Positioning

Gleam is a simple, lightweight crypto wallet for people who want to interact with on-chain systems without wrestling with their wallet.

---

## Part 2 — Visual Identity

### Logo

#### Primary Logo

The primary logo is the lowercase gleam wordmark paired with the small five-color Gleam beam.

The wordmark should remain visually quiet. The beam supplies the brand recognition.

#### Logo Variations

Approved:

- Wordmark + beam — primary use
- Wordmark only — when color is inappropriate
- Beam only — browser extension icon, favicon and small-scale applications
- Monochrome — situations where color reproduction is unavailable

#### Clear Space

Maintain clear space around the logo equal to at least the height of the lowercase "g" on all sides.

Do not allow UI elements, text or other graphics to visually collide with the beam.

#### Minimum Size

Digital:

- Wordmark + beam: 80px wide minimum
- Beam icon: 16px minimum
- Preferred extension icon: 32px+

If the logo becomes illegible, use the beam icon rather than shrinking the full wordmark.

#### Incorrect Usage

Never:

- Stretch or distort the logo
- Rotate the beam
- Add gradients to the beam
- Add shadows or glow
- Change the beam's color order
- Add outlines
- Place the logo over visually noisy backgrounds
- Turn the beam into a generic rainbow gradient

### Color Palette

#### Primary

|Color|Hex|Usage|
|-|-|-|
|Gleam Black|`#111111`|Primary text, buttons, icons|
|White|`#FFFFFF`|Primary canvas and dominant background|

#### Beam

|Color|Hex|Usage|
|-|-|-|
|Red|`#FF1717`|Beam / accent|
|Purple|`#8B12FF`|Beam / accent|
|Sky|`#73C9E8`|Beam / accent|
|Yellow|`#FFE45C`|Beam / accent|
|Green|`#28F02D`|Beam / accent|

#### Neutrals

|Color|Hex|Usage|
|-|-|-|
|Mist|`#F5F5F5`|Secondary surfaces|
|Line|`#E5E5E5`|Borders and dividers|
|Muted|`#737373`|Secondary text|

#### Color Usage

The intended visual ratio is approximately:

> 90% neutral / 10% color

The beam is a signature, not a palette to decorate the whole interface.

Good:

- Small beam under a navigation area
- Five-color loading indicator
- Small accent beside the logo
- Color-coded status
- A single beam in a marketing composition

Bad:

- Rainbow buttons
- Rainbow backgrounds
- Rainbow gradients
- Every icon being a different beam color
- Large colored cards
- Neon crypto aesthetics

#### Accessibility (Color)

Do not use the beam colors as the sole means of communicating information.

Small yellow, green, sky and red elements should not be relied upon for readable text unless sufficient contrast is achieved.

#### Dark Mode

|Light|Dark equivalent|
|-|-|
|White (`#FFFFFF`) canvas|Gleam Black (`#111111`) canvas|
|Gleam Black (`#111111`) text|White (`#FFFFFF`) text|
|Mist (`#F5F5F5`) surface|Elevated Dark (`#1C1C1C`) — near-black elevated surface|
|Line (`#E5E5E5`) border|Dark Line (`#2A2A2A`) — low-contrast dark border|

Elevated Dark and Dark Line mirror the light-mode step ratios (canvas → surface → border) rather than being picked arbitrarily, so elevation reads the same way in both themes.

Beam-on-dark, verified against `#111111` canvas (WCAG contrast ratio):

|Color|Hex|Contrast vs. `#111111`|Text use on dark|
|-|-|-|-|
|Yellow|`#FFE45C`|14.8:1|Safe for text at any size|
|Green|`#28F02D`|12.2:1|Safe for text at any size|
|Sky|`#73C9E8`|10.1:1|Safe for text at any size|
|Red|`#FF1717`|4.8:1|Safe for body text (AA); avoid for small/thin text|
|Purple|`#8B12FF`|3.3:1|Non-text use only (beam, dot, icon) — fails AA as a text color on dark|

Rules:

- All five beam colors carry over unchanged (same hex) to dark mode — no separate dark-mode beam palette is needed. The one exception is Purple, which is reserved for non-text uses (the beam itself, status dots, icon fills) on dark surfaces and must not be used as dark-mode text color.
- The 90/10 neutral-to-color ratio holds in dark mode exactly as in light mode.
- The extension popup should be assumed to render in both themes from day one — this is not an enhancement to add later.

### Typography

#### Primary Typeface: Inter

Use across product, marketing and documentation.

Recommended weights:

- Regular 400
- Medium 500
- Semibold 600
- Bold 700

#### Secondary / Technical Typeface: JetBrains Mono

Use selectively for:

- Wallet addresses
- Transaction hashes
- Technical identifiers
- Developer-facing content

Do not use monospace for normal UI copy.

#### Addresses & Technical Values

- Show full addresses, uncut, anywhere a signing or sending action is being confirmed. Truncation is reserved for low-stakes, glanceable lists (activity feed, connected apps) — never a confirmation screen.
- Wrap long monospace values instead of truncating them when space is tight.
- Every displayed address needs a visible, one-tap copy affordance.
- Give monospace text slightly more line height than body copy at the same size.

#### Type Hierarchy

|Level|Weight|Size|Usage|
|-|-|-|-|
|Display|600|40–64px|Marketing|
|H1|600|32–40px|Major page headings|
|H2|600|24–28px|Sections|
|H3|600|18–20px|Components|
|Body|400|14–16px|Normal copy|
|Label|500|12–14px|UI labels|
|Caption|400|11–12px|Supporting information|

#### Typography Rules

- Prefer sentence case.
- Avoid unnecessary uppercase text.
- Keep headings short.
- Use tight tracking on large headings.
- Use comfortable line height for body text.
- Never use typography tricks to manufacture personality.
- Let whitespace do the work.

#### Fallback

```css
font-family:
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

### Imagery

#### Photography

Photography is secondary to product imagery.

If photography is used:

- Natural
- Clean
- Contemporary
- Minimal composition
- Neutral backgrounds
- Little visual clutter

Avoid stock-photo aesthetics.

#### Illustration

Illustration should use:

- Hard-edged geometry
- Thin technical lines
- White space
- Simple planes
- Beam colors used sparingly

The hyperBEAM visual language is inspiration for the geometry, not something to copy literally.

#### Iconography

Icons should be:

- Simple
- Functional
- Monochrome by default
- 1.5–2px stroke
- Consistent in scale
- Geometrically clean

The UI icons should not compete with the Gleam beam.

---

## Part 3 — Risk, States & Accessibility

The brand's central promise — friction proportional to risk, mechanism over claim — has to be visible on screen, not just true in copy. This section makes that promise concrete and testable.

### Risk & Severity Tiers

Three tiers. Severity is carried by layout, weight and copy first; color reinforces only at the top tier, never leads.

|Tier|Examples|Confirmation|Color|
|-|-|-|-|
|Routine|Viewing balance/address, opening the wallet|None, or one lightweight tap|Neutral only|
|Consequential|Sending funds, granting a scoped/budgeted/time-boxed permission, connecting to a known app|One clear screen: what leaves, what's received, counterparty, plain-language description, full address|Neutral, black primary button|
|Irreversible / high-exposure|Sending to a first-seen address, an unlimited grant, revoking recovery, exporting key material|Explicit acknowledgment of the specific stated risk — not a generic "Are you sure?"|The only place a single warning red accent is used|

Rules:

- Never use the five-color beam as a severity/warning signal — it's reserved for brand/identity moments.
- The warning red is used only at the Irreversible tier. If it starts showing up elsewhere, that's a sign severity is being miscategorized, not that the palette needs to expand.
- A screenshot with all color desaturated should still make the tier obvious from layout and copy alone.

### Motion & Loading

- Default to structural skeleton placeholders (shapes matching the eventual layout), not spinners.
- Where an indicator is unavoidable (e.g. a pending transaction), use a thin animated beam-sweep — the one approved motion motif — instead of a generic spinner.
- Loading states resolve quickly or explain a delay. No silent, indefinite waits.
- Respect `prefers-reduced-motion`: every animation (beam-sweep included) has a static/near-instant fallback.

### Empty States

- The one place brand personality's "release valve" (a single dry, understated line) is allowed to show.
- Typographic and restrained — a short line of copy, at most a single-line geometric illustration. Never a mascot or cartoon character.
- Never uses the Irreversible-tier warning red — an empty state is not a problem state.

### Error States

- Neutral palette and direct copy by default — most errors (network hiccup, wrong password) are Consequential at most.
- Reserve warning red for errors that are also Irreversible in consequence (e.g. a transaction that may have partially executed).
- No cheerful-bot treatment: no emoji, no "Oops!", no illustrated apology character.

### Accessibility (General)

- **Contrast**: Body text meets WCAG AA (4.5:1) minimum; primary actions and Irreversible-tier warning copy meet AAA (7:1) where feasible. Muted (`#737373`) on white is borderline at small sizes — verify at actual type size before shipping; prefer Gleam Black for anything load-bearing.
- **Never color-only**: Every status or severity signal also carries an icon, label, or copy difference — not color alone.
- **Focus states**: Every interactive element has a visible, high-contrast focus ring.
- **Motion**: `prefers-reduced-motion` is respected everywhere, not just in loading states.
- **Targets**: Interactive elements keep a minimum comfortable touch/click target size, even in the compact popup.

---

## Part 4 — Verbal Identity

### Brand Voice

Gleam sounds like software that already works.

It is direct, calm, precise and confident without trying to convince you that it is trustworthy.

### Tone Dimensions

#### Direct

Say the thing.

- ✅ Send ETH
- ❌ Initiate a secure asset transfer

#### Clear

Prefer ordinary words over crypto jargon.

- ✅ Receive
- ❌ Deposit digital assets

#### Calm

No hype.

- ✅ Your transaction is ready.
- ❌ Your transaction is about to launch into the decentralized future.

#### Lightweight

Short copy wherever possible.

- ✅ Wallet connected.
- ❌ Your wallet has been successfully connected and is now ready for interaction.

### Voice Qualities

|Quality|Do|Don't|
|-|-|-|
|Direct|"Send ETH"|"Begin sending assets"|
|Simple|"Network fee"|"Estimated network execution cost"|
|Confident|"Transaction confirmed."|"Great news! Your transaction was successfully confirmed!"|
|Technical|"0.01 ETH"|"A small amount of Ethereum"|
|Human|"Try again"|"Please retry the operation"|

### Writing Style

#### Sentence Length

Prefer 3–12 words.

Longer explanations are appropriate when the user genuinely needs the information.

#### Punctuation

Use normal punctuation.

Avoid:

- Excessive exclamation marks
- Ellipses
- Marketing-style punctuation
- Decorative symbols

#### Capitalization

Use sentence case.

- ✅ Select network
- ❌ SELECT NETWORK

#### Numbers

Use numerals for:

- Balances
- Fees
- Percentages
- Transactions
- Technical values

#### Contractions

Use them naturally.

- You're ready.
- It's connected.

### Vocabulary

#### We Say

wallet · send · receive · connect · balance · transaction · network · fee · address · on-chain · simple · clear

#### We Don't Say

decentralized finance ecosystem · revolutionary · next-generation · Web3 revolution · financial freedom · unlock · supercharge · frictionless · seamless · institutional-grade · trustless future · moon

The product can be technically sophisticated without sounding sophisticated.

---

## Part 5 — Messaging

### Core Message

Crypto should feel simpler.

Gleam removes the unnecessary complexity between you and your on-chain assets.

### Value Proposition

Gleam is a lightweight crypto wallet designed around fast, clear interactions. It gives you the essentials — your assets, networks and transactions — without burying them beneath unnecessary interface and crypto jargon.

### Tagline

#### Primary tagline

> Crypto, without the clutter.

#### Alternative product line

> A simpler crypto wallet.

Use the tagline sparingly. The product should communicate the positioning through the experience rather than constantly stating it.

### Key Messages

1. **Simple by default** — The wallet surfaces what matters and gets out of the way.
2. **See what's happening** — Balances, networks, fees and transaction details should be understandable before users confirm an action.
3. **Lightweight** — Gleam should feel fast and small — like software rather than a financial dashboard.
4. **Built for on-chain** — Gleam is technically capable without exposing unnecessary technical complexity.

---

## Part 6 — Brand in Use

### Digital

#### Website

The website should follow the same visual hierarchy as the wallet:

> White → information → beam

Use:

- Large white canvas
- Black typography
- Sparse content
- Strong product screenshots
- Occasional geometric beam
- Minimal navigation

Avoid filling the hero with decorative graphics.

#### CTAs

Primary CTA:

> Get Gleam

Secondary:

> Explore Gleam

Avoid:

- Start your journey
- Unlock the future
- Join the revolution
- Get started today

#### Product UI

The wallet should feel like a small, precise instrument.

Layout — prefer:

> one clear hierarchy → one primary action → supporting information

Avoid:

> many cards → many controls → many competing actions

Buttons:

- Primary buttons should generally be black with white text.
- Secondary actions should use a white background, thin border, black text.
- The beam should almost never be used as a button background.

Borders: use subtle borders rather than heavy shadows.

Shadows: use very sparingly. The default Gleam UI should be able to function almost entirely without shadows.

#### Social Media

Social content should be visually recognizable without requiring the Gleam logo in every post.

Preferred composition:

> white background + black type + one beam

Use product screenshots wherever possible. Copy should be short and matter-of-fact.

- ✅ Your wallet shouldn't get in the way.
- ❌ The future of decentralized finance has arrived.

#### Email

Keep email visually minimal.

- Header: beam + gleam
- Body: short paragraphs, clear action, minimal decorative elements.

#### Presentations

Use:

- White backgrounds
- Large black headings
- Inter
- Sparse content
- Beam accents
- Product screenshots

A slide should generally communicate one idea.

### Brand Don'ts

The following are the most important rules.

- Don't make Gleam look like a generic crypto product.
- Don't turn the beam into a rainbow gradient.
- Don't overuse the five colors.
- Don't fill white space unnecessarily.
- Don't use crypto clichés: coins, chains, glowing networks, rockets, shields.
- Don't make the product look like a bank.
- Don't use corporate or hype-heavy language.
- Don't add visual complexity merely to make the brand feel sophisticated.

#### The simplest test

Remove an element. If the design gets better, leave it out.

---

## Part 7 — Brand System

### The Gleam Formula

```
WHITE SPACE
    +
PRECISION
    +
BLACK TYPOGRAPHY
    +
ONE DISTINCTIVE BEAM
    =
GLEAM
```

### Recognition Hierarchy

When someone sees Gleam, recognition should happen in this order:

1. White space
2. Precise black interface
3. Small beam of five colors
4. gleam wordmark

This means the brand should remain recognizable even when the logo is absent.

### Design North Star

> Make crypto disappear. Keep the signal.

Gleam's visual identity should make the underlying complexity of crypto feel smaller, while the five-color beam gives the product one unmistakable visual signature.

---

## Part 8 — Contacts & Assets

**Brand guardian**: Not yet assigned — pre-launch, single-maintainer project. Until a dedicated owner exists, brand decisions default to the principles in this document rather than to any individual's preference.

**Asset location**: Source files live in this repo under `brand/` (this guide, context, strategy, voice, positioning, messaging) and `brand/assets/`. No external design tool (Figma, etc.) is connected yet — when one is, link it here.

**Questions**: Open an issue in this repo, or raise it directly with Will (<skyfoxx@sacred.finance>).
