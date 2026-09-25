# Gleam — Visual Identity Brief

> For the designer: this brief assumes no prior context. Gleam is a browser-extension wallet for AO and Arweave only (not multichain). Its positioning is simple, fast, easy — full stop. Everything underneath (scoped grants, plain-language previews, tested recovery) exists to keep that simplicity honest, but it is never the headline. The visual identity should look like that promise: warm, approachable, unmistakably friendly — closer to a well-loved developer tool than a security product. The direct reference is [gleam.run](https://gleam.run) (the programming language's site) — its cream background, dark contrast section, single confident accent color, and friendly rounded mascot are the model to adapt, not a rainbow/prism motif.

---

## 01 — Identity Strategy Statement

Gleam is a crypto wallet designed to make interacting with on-chain systems feel simple, immediate and lightweight. Its identity should communicate clarity through reduction: mostly white space, precise typography, restrained interfaces and almost no decorative noise. A distinctive five-color hard-edged "beam" provides the brand's signature — a small burst of color against an otherwise monochrome system. Gleam should feel like a piece of software that simply works rather than a financial product trying to establish trust through visual authority.

## 02 — Logo Direction

### Primary direction

A minimal lowercase wordmark:

> **gleam**

The lowercase treatment makes the brand approachable and modern without becoming playful. The wordmark should be typographic rather than emblem-heavy.

A small five-color geometric beam can act as the brand's signature mark alongside the wordmark.

### Character

- Light
- Precise
- Technical
- Effortless
- Modern
- Quietly distinctive

### The Gleam mark

The strongest direction is a small horizontal beam composed of five hard-edged color segments:

> ■ ■ ■ ■ ■

The segments can subtly increase/decrease in width or form a directional beam. It should feel like a signal passing through the interface rather than a conventional rainbow logo.

The mark should work independently at favicon / extension-icon size.

### Avoid (logo)

- Cryptocurrency coins
- Shields
- Locks
- Keys
- Crowns
- Eagles / animals
- Generic blockchain nodes
- Gradient "Web3" logos
- Futuristic sci-fi typography
- Heavy geometric monograms
- Excessively rounded SaaS logos

### Logo references

- **Linear** — borrow the restraint and confidence of its wordmark system.
- **Vercel** — borrow the ability to make an extremely simple geometric mark feel like a serious piece of developer infrastructure.
- **Google** — borrow the idea of a small, highly recognizable multi-color signature that can appear sparingly without making the entire interface colorful.

## 03 — Color Palette

The palette is fundamentally white + black, with the Gleam beam providing the recognizable color system.

### Primary

|Color|Hex|Usage|
|-|-|-|
|Gleam Black|`#111111`|Primary text, controls and high-contrast UI. Should feel softer than pure black while maintaining excellent contrast.|

### Foundation

|Color|Hex|Usage|
|-|-|-|
|White|`#FFFFFF`|The dominant brand color. Large areas of white space are an intentional part of the identity, not unused space.|
|Mist|`#F5F5F5`|Subtle surfaces, input backgrounds and inactive UI.|
|Line|`#E5E5E5`|Borders and separators.|

### Gleam Beam

|Color|Hex|
|-|-|
|Red|`#FF1717`|
|Purple|`#8B12FF`|
|Sky|`#73C9E8`|
|Yellow|`#FFE45C`|
|Green|`#28F02D`|

These five colors should almost never be used as large fills. Their primary purpose is recognition, not decoration.

### Usage rule

The approximate visual ratio should be:

> **85–95% neutral / 5–15% color**

The beam can appear as:

- a small logo
- a 1–4px horizontal accent
- an active-state indicator
- a loading animation
- a transaction/status signal
- occasional geometric decoration
- selected moments in marketing

Never create rainbow buttons, rainbow backgrounds or rainbow gradients.

### Color personality

Clean monochrome + unexpected color.

The contrast is important: Gleam should look almost entirely monochromatic until the beam appears.

### Dark mode

The extension popup inherits the OS/browser theme far more often than a marketing site does — dark mode is a default state to design for, not an edge case.

- The relationship inverts: Gleam Black (`#111111`) becomes the canvas, White becomes the primary text/control color.
- Mist and Line need dark-mode equivalents (a near-black elevated surface, a low-contrast dark border) rather than simply staying light values on a dark ground.
- The five beam colors are not automatically safe on a dark canvas — Yellow and Sky in particular need contrast-checked, possibly slightly desaturated, dark-mode variants rather than reuse of the light-mode hex values.
- The beam's role stays identical: sparing, signature, never decorative. Dark mode changes the canvas, not the ratio.

This is a system to specify before build, not to leave to whatever the framework defaults to.

## 04 — Typography

### Primary typeface: Inter

Use Inter throughout the product. It is highly legible at small extension sizes, has excellent numerals and feels neutral enough to let the visual system carry the personality.

### Alternative: Geist Sans

Use if the product wants a slightly more contemporary developer-tool character.

### Type personality

Typography should feel engineered rather than branded.

Avoid unusual display fonts. Gleam's personality comes from spacing, hierarchy and the beam — not typography tricks.

### Hierarchy

|Level|Treatment|
|-|-|
|Balance / primary figures|Large, bold, tight.|
|Headings|Medium / semibold.|
|Body|Regular.|
|Labels|Medium, small, slightly increased tracking where useful.|
|Addresses / hashes / technical values|Monospace where it materially improves scanning.|

### Addresses & technical values

Addresses are trust-critical, not decorative — the voice guide bans truncated addresses in confirmation copy, and the visual system needs to make that possible without breaking layout.

- Full addresses are shown by default anywhere consequence is being confirmed (approval/signing screens). Truncation is only acceptable in low-stakes, glanceable contexts (an activity feed row, a connected-apps list) — never where money is about to move.
- When a full address must sit in a tight layout, wrap it (monospace, tabular figures) rather than truncate it. Truncation should never be the fix for a layout constraint on a signing screen.
- Give every address a visible copy affordance — precision that can't be acted on (copied, verified) doesn't serve the "mechanism over claim" principle.
- Monospace values get very slightly more line height than body text of the same size — dense hex/base64 strings need the extra breathing room to stay scannable.

### Avoid (typography)

- Geometric futuristic fonts
- Rounded "friendly fintech" fonts
- Serif typography
- Condensed display fonts
- Excessive letter spacing
- All-caps UI everywhere

## 05 — Imagery & Visual Language

Gleam should have very little conventional photography.

The visual world should be built around:

- White space
- Interfaces
- Geometric beams
- Precise lines
- Cropped color
- Small moments of motion
- Abstract on-chain/network structures

### Overall aesthetic

Quiet technical minimalism with flashes of color.

A Gleam marketing page should be capable of being almost entirely white with one small beam providing the visual focal point.

### Abstract graphics

Use hard-edged geometric constructions inspired by the hyperBEAM reference:

- intersecting lines
- angular planes
- beam-like shapes
- clipped rectangles
- thin technical diagrams
- five-color horizontal elements

But simplify aggressively. The source inspiration is a visual vocabulary, not something to reproduce literally.

### Avoid (imagery)

- Generic blockchain 3D renders
- Floating coins
- Glowing networks
- Cyberpunk
- Purple-blue crypto gradients
- Stock photography
- "Future of finance" imagery
- Excessive abstract blobs

## 06 — Iconography & Illustration

### Style

Simple, functional line icons. Icons should look like interface primitives rather than illustrations.

- 1.5–2px stroke
- Minimal geometry
- Mostly monochrome
- Sharp or subtly rounded corners
- Consistent optical sizing

### Personality

Functional first. The beam is expressive; the icons are not.

This creates a useful distinction: Gleam can have personality without turning every component into branded decoration.

## 07 — Design Principles

### 1. White Is the Canvas

White space is a primary component of Gleam's identity.

Interfaces should breathe. Avoid filling every available area with cards, gradients, backgrounds or decorative elements.

### 2. Color Means Something

The five-color beam is scarce enough to remain recognizable.

When color appears, it should indicate identity, activity, movement or an important state — not simply make something prettier.

### 3. Remove the Wallet

Gleam should hide unnecessary crypto complexity.

Every screen should answer one question clearly and expose only the controls required for the current task.

### 4. Precision Without Heaviness

Borders, spacing, typography and alignment should be exact, but the result should remain visually light.

No excessive shadows, thick borders, oversized cards or enterprise-dashboard density.

### 5. One Release Valve

The brand personality has a "dry, almost-playful edge" (per the strategy and voice guides) that the visual system, as specified above, never expresses — every principle so far is about restraint and precision. Empty states are the one sanctioned place for that edge to show: a single dry line, never a mascot or cartoon. It appears nowhere else — not on signing screens, not in errors, not in onboarding beyond a single warm line. One valve, used consistently, is what keeps this a controlled release rather than a crack in the discipline.

## 08 — Risk & Severity System

The brand's central claim is "friction proportional to risk" — a routine confirmation and an irreversible transfer to a new address should never read the same. This is currently the highest-stakes undefined surface in the identity: without a stated system, severity gets decided ad hoc in code, screen by screen, and starts to drift.

### Tiers

Three tiers, not a color-coded traffic-light system — the beam is reserved for identity/brand moments, not warning states, so severity is carried by layout, weight and copy first, and color only at the top tier.

**Routine** — balance updates, viewing an address, opening the wallet.

- No confirmation step, or a single lightweight tap.
- Neutral palette only (black/white/Mist/Line). No beam.

**Consequential** — sending funds, granting a scoped, budgeted, time-boxed permission, connecting to a known app.

- A single clear confirmation screen: what leaves, what's received, counterparty, plain-language description, full address.
- Neutral palette, black primary action button. No red, no beam — precision is the reassurance, not color.

**Irreversible / high-exposure** — sending to a first-seen address, an unlimited or unusually broad grant, revoking recovery, exporting key material.

- A confirmation that requires an explicit acknowledgment of the specific risk (not a generic "Are you sure?") — state the actual fact: new address, no spending limit, action can't be undone.
- This is the one place a single, deliberate warning color (not the five-color beam) is appropriate — a single hard-edged red accent, used only here, so its rarity keeps it meaningful. It should never appear at the Routine or Consequential tier.

### Principle

Severity is legible from typography and copy alone, with color as reinforcement only at the top tier — never the reverse. A screenshot with color removed should still make the stakes obvious.

## 09 — Motion, Loading & Empty States

Speed is a felt, daily claim ("fast, and it feels fast") — the visual system needs a stated way to make waiting and absence feel intentional, not just an unstyled gap before content arrives.

### Loading

- Prefer a subtle, structural placeholder (skeleton shapes matching the eventual layout) over a spinner — it previews the answer's shape instead of just signaling "wait."
- Where a loading indicator is unavoidable (e.g. an in-flight transaction), the five-color beam is the one approved motif — a thin animated beam-sweep, not a generic spinner — reinforcing brand recognition at a moment the user is already paying attention.
- No skeleton or loading state should exceed a very brief, deliberately short duration before either resolving or explaining a delay. Silence reads as broken, not calm.

### Empty states

- This is the identity's sanctioned "release valve" (see Design Principles, §5) — a place for a small flash of dry, understated personality without undermining the mechanical precision used everywhere else.
- Still typographic and restrained: a short line of copy, optional single-line illustration in the hard-edged geometric style, never a cartoon mascot or stock illustration.
- Never uses the warning/red accent reserved for the Irreversible tier — an empty state is not a problem state.

### Error states

- No red-alert styling by default. Most errors (network hiccup, wrong password) are Consequential at most — neutral palette, direct copy, a clear next step.
- Reserve the single warning red for errors that are also Irreversible-tier in consequence (e.g. a failed transaction that may have partially executed) — not for routine failures like a rejected password attempt.
- Never a cheerful-bot visual treatment (no emoji, no illustrated "oops" character) — this mirrors the voice guide's ban on apology theater.

## 10 — Accessibility

Accessibility is a mechanism-over-claim commitment, not a compliance checkbox — it gets the same specificity as everything else in this document.

- **Contrast**: All body text meets WCAG AA (4.5:1) against its background at minimum; primary actions and any Irreversible-tier warning copy meet AAA (7:1) where feasible. Muted (`#737373`) on white is borderline for small text — verify at the actual type size used before shipping, and prefer Gleam Black for anything load-bearing.
- **Never color-only**: Every status, severity tier, or state communicated with color also carries an icon, label, or copy difference. A colorblind user should be able to tell a Consequential screen from an Irreversible one without perceiving color at all.
- **Focus states**: Every interactive element has a visible, high-contrast focus ring — not the browser default, but not removed either. The wallet is a keyboard-navigable instrument, not just a mouse target.
- **Motion**: Respect `prefers-reduced-motion` — the beam-sweep loading treatment and any transition/animation degrade to a static or near-instant equivalent rather than forcing motion on users who've opted out.
- **Touch/click targets**: Minimum comfortable target size on all interactive elements, even in the compact popup — precision in layout should never come at the cost of a target too small to reliably hit.

## 11 — Brand Expressions

### Browser Extension

The primary expression of Gleam.

Small, white, extremely clean popup with black typography and occasional beam accents.

The wallet should feel almost like a tiny piece of system software, not a miniature banking website.

### Wallet Icon

A simple Gleam beam mark.

At small sizes, prioritize the five-color geometry over the wordmark.

### Website

- Large white canvas.
- Large lowercase gleam wordmark.
- Sparse copy.
- Black typography.
- One strong geometric beam.

Product UI should appear as the primary visual proof rather than decorative hero artwork.

### Social

Mostly monochrome posts with one recognizable Gleam element.

Examples:

- white → black → beam
- or a cropped UI screenshot with a small five-color accent.

Avoid the conventional crypto aesthetic of dark backgrounds, neon gradients and token imagery.

### Product Marketing

Use the beam as a recurring visual transition:

> white → beam → information

The beam can represent movement from complexity to clarity, or information moving through the system.

### Core Identity

If everything else is stripped away, Gleam should be recognizable through these five things:

1. Lowercase **gleam**
2. White space
3. Black, precise typography
4. Five hard-edged colors: red / purple / sky / yellow / green
5. The beam — used sparingly

### Brand equation

> Gleam = White Space + Precision + Beam

Not:

> Gleam = Crypto + Rainbow + Decoration

The restraint is what makes the color distinctive.
