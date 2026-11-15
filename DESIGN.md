# Gleam Design System

## Brand Identity

**Gleam** is a lightweight, trustworthy wallet for Arweave and AO. The brand embodies clarity, speed, and a playful sense of discovery—like light catching something valuable. Our design language is minimal and purposeful, putting the user's assets and actions at the center.

### How the Brand Feels

- **Luminous and direct**: Bright, clean interfaces that cut through complexity
- **Playful but serious**: The rainbow beam is vibrant; everything else is understated
- **Fast and responsive**: No unnecessary friction, instant visual feedback
- **Accessible by default**: High contrast, careful typography, motion-aware
- **Trustworthy**: Transparent about what's happening, especially when money moves

### Character

- Light
- Precise
- Technical
- Effortless
- Modern
- Quietly distinctive

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

### 3. Precision Without Heaviness

Borders, spacing, typography and alignment should be exact, but the result should remain visually light.

No excessive shadows, thick borders, oversized cards or enterprise-dashboard density.

---

## In the app

- **Spacing before lines.** Separate groups with padding and gaps. Add a
  divider or border only when spacing can't separate them, and never
  stack borders, such as a row's own separator inside a bordered section.
- **One short line.** UI copy has no hint lines and no second sentences.
  Fix a confusing control with structure (a clear label, an action
  button, the reason a button is disabled), not more words. If a control
  already says it, say nothing.

---

## Color System

### Foundation (Neutral Palette)

The neutral foundation is refined and minimal, with separate tokens for structural hierarchy and semantic meaning.

**Light Mode (Default)**
- **Canvas** `#f5f5f5` — Outermost container background
- **Background** `#ffffff` — Primary surface for content
- **Surface** `#ffffff` — Elevated or grouped content areas
- **Mist** `#f5f5f5` — Subtle background for inactive/secondary states
- **Line** `#e5e5e5` — Dividers and borders
- **Foreground** `#111111` — Primary text
- **Muted** `#737373` — Secondary text, disabled states
- **Faint** `#a3a3a3` — Tertiary text, placeholder text

**Dark Mode**
- **Canvas** `#171717` — Outermost container background
- **Background** `#171717` — Primary surface for content
- **Surface** `#212121` — Elevated or grouped content areas
- **Mist** `#212121` — Subtle background for inactive/secondary states
- **Line** `#2e2e2e` — Dividers and borders
- **Foreground** `#e5e5e5` — Primary text
- **Primary fill** `#d4d4d4` — The primary button, a step below the text so it is not the brightest thing on screen
- **Muted** `#a3a3a3` — Secondary text, disabled states
- **Faint** `#737373` — Tertiary text, placeholder text

Light mode is high contrast (7:1+). Dark mode is softened, not inverted: no pure white or near-black, and body text sits around 14:1 so the screen doesn't glare. Text still passes AA.

### Semantic Colors

Red marks errors and the Irreversible risk tier only, never a status default or decoration. Routine notices use **Caution** or **Muted**.

| Token | Light | Dark | Use |
|---|---|---|---|
| **Warning** | `#ff1717` | `#f87171` | Warning and error text, icons |
| **Warning fill** | `#c93a3f` | `#c93a3f` | Behind white text (destructive button), 5:1 |
| **Warning surface** | `#fff5f5` | `#2a1515` | Critical notice background |
| **Caution** | `#c2410c` | `#fb923c` | Worth reading, not a danger |
| **Positive** | `#16a34a` | `#4ade80` | Confirmed amounts, gains |

Beam red (`#ff1717`) is identity only and stays the same in both themes. In dark mode, warning uses its own softer red, because the saturated beam red glows on a dark canvas.

### The Gleam Beam — Identity

The five-stop beam is Gleam's signature visual element. It appears as a gradient divider, in loading states, and occasionally as accent highlights. Each segment has its own meaning within the context, but together they form a cohesive identity.

- **Beam Red** `#ff1717` — Segment 1 (0–20%)
- **Beam Purple** `#8b12ff` — Segment 2 (20–40%)
- **Beam Sky** `#73c9e8` — Segment 3 (40–60%)
- **Beam Yellow** `#ffe45c` — Segment 4 (60–80%)
- **Beam Green** `#28f02d` — Segment 5 (80–100%)

#### Using the Beam

- **Dividers**: A thin 3px gradient bar separates major sections and creates visual breathing room
- **Loading shimmer**: A subtle moving highlight travels across content being loaded, hinting at the beam's colors
- **Accent never fills**: The beam colors are never used for large solid fills or buttons—they're always linear, moving, or small accent points
- **Purple limitation**: Beam purple (`#8b12ff`) is not used for text on the dark canvas due to insufficient contrast; use it only for decorative or non-text contexts

## Typography

### Type Scale

Optimized for the 400px popup frame and designed to feel crisp and modern.

| Level | Size | Actual | Line Height | Use Case |
|-------|------|--------|-------------|----------|
| **Caption** | `0.6875rem` | 11px | 1.4 | Hints, footnotes, minimal supporting text |
| **Label** | `0.75rem` | 12px | 1.4 | Form labels, badge text, table headers |
| **Body** | `0.875rem` | 14px | 1.5 | Main content, lists, activity descriptions |
| **H3** | `1.125rem` | 18px | 1.3 | Section headings, card titles |
| **H2** | `1.5rem` | 24px | 1.25 | Screen titles, primary headings |
| **Display S** | `1.75rem` | 28px | inherited | Amounts on approval and review screens |
| **Display** | `2.25rem` | 36px | inherited | Wallet balance, chart value |
| **Display L** | `2.5rem` | 40px | inherited | The hero amount on transfer review and Points |
| **Micro** | `0.625rem` | 10px | inherited | Glyph letters in small avatars and token marks |

Each level is a token in `packages/ui/src/tokens/theme.css` (`text-caption` … `text-display-lg`, `text-micro`). The phone layout raises Caption, Label and Body by 1px. ESLint (`gleam/type-scale`) refuses a raw `text-[Npx]` size.

### Font Families

- **Sans-serif**: `Inter`, -apple-system, BlinkMacSystemFont, `Segoe UI`, sans-serif
  - Inter is Gleam's voice: geometric, friendly, highly legible at small sizes
  - System fallbacks ensure excellent rendering on every OS
- **Monospace**: `JetBrains Mono`, ui-monospace, monospace
  - Used for hashes, addresses, transaction IDs, and code snippets
  - Provides clarity and a technical feel where needed

---

## Motion

Motion reinforces the brand's sense of responsiveness and care. Every animation respects `prefers-reduced-motion`.

### Key Animations

**Shimmer Sweep** (1.6s, linear)
- A subtle moving gradient highlight across content being loaded
- Uses beam colors at low opacity (7–9%) mixed with white/black
- Creates a sense of activity without distraction

---

### Points program (`gleam.html`, `points.html`, `invite.html`)

The Gleam Points pages are the one place where the beam runs at full power.
They break several rules above on purpose, and the rest of the site stays
quiet. Shared pieces are in `apps/site/program.css` and `program.js`: ink
bands, section cuts, the odometer, the ping and the sound toggle. Each page
adds its own `<page>.css` and `<page>.js`.

- **Ink bands.** The hero, the timeline and the CTA sit on ink `#0A0A0A`,
  with white text and muted `#A3A3A3`. The light bands (`#F7F7F7` and
  white) carry the reading sections between them. The header and footer
  are on ink on this page.
- **Section breaks** are never flat. An angled cut carries the five beam
  hairlines along its edge. A curved cut is stroked with the beam. A
  gradient fade takes white down to ink before the timeline. Each break is
  an SVG with `vector-effect: non-scaling-stroke`, so lines stay 2px at any
  width.
- **Beam as a stack.** Here the beam is often five stacked stripes (2px
  each, 10px in all) running the full bleed, not a 72px run of segments.
  It is still a line and never a fill.
- **Motion has to mean something.** One clock drives it all. An example
  balance of 250 AO earns 250 points a day, sped up 240×.
  - A pulse on the hero beam is a point on its way.
  - Shards from the beam's end are that point arriving.
  - The drizzle between pulses is fractional points accruing.
  - Each whole point lands with an odometer roll, a punch, a one-frame
    split into beam colours, a `+1`, a shockwave and the ping.
  - The timeline's lit beam is time passing. "You are here" is a beacon,
    and the counter runs from it.
  - Decorative loops, floating particles, pulsing buttons and confetti
    stay out. XP bars, streaks, levels and badges stay out too.
- **Colour per point.** Points cycle red, purple, sky, yellow, green. The
  ping steps up a major pentatonic in the same order, so five points climb
  the beam.
- **Sound.** The ping is synthesised with Web Audio: a noise click, a
  glass-bar partial stack and a short damped echo. It is on by default and
  arms on the first gesture. A fixed "Sound on / Sound off" pill stays on
  screen, and its state is stored in `localStorage` under `gleam:sound`.
- **The counter is always labelled as an example** and is never shown as a
  real or projected balance.
- **Pausing.** The clock runs only while the tab is visible and a counter
  or signal is on screen.
- **Reduced motion.** The canvas, the pulses, the punch and the
  scroll-driven timeline all drop out. The counters still tick, and the
  timeline becomes a plain horizontal scroller parked at "you are here".

- **Per page, the motion is the rule it shows:**
  - `gleam.html` is the example accelerator and the AO timeline, described
    above.
  - `points.html`:
    - A dial fills with the UTC day toward the real daily count at
      00:00 UTC.
    - The stats roll in from zero.
    - The calculator's results are an ink scoreboard. Its odometers roll,
      a breakdown bar shows where the points come from, and a ping plays
      once the inputs settle.
    - The invite pulse is the bonus paid to both wallets, every day.
    - The how-it-works beam fills as you read.
    - The whale-curve chart puts your calculator balance on the curve.
  - `invite.html`:
    - The invite is a ticket. The code resolves onto it like a slot
      machine.
    - Each seat glyph is a real seat on the code.
    - A stamp records the outcome: "In Gleam", "Full" or "Not found".
- **Charts in the program** use ink for the series and a dashed grey line
  for the reference. Labels sit on the lines, the axes stay faint, and a
  hover crosshair and a hidden table back the chart up. The breakdown bar
  uses beam sky, red and yellow. As a set they pass the colour-blindness
  checks but not the lightness band, so every segment also has a gap and a
  labelled value.

### Things Not to Say

- No trust-by-assertion claims: "bank-grade," "military-grade," "industry-leading security" — trust isn't the pitch here at all; simplicity is.
- No multichain or feature-count framing ("supports X chains") — the AO/Arweave-only focus is a positioning choice, not a limitation to apologize for.
- No generic wallet clichés: "your gateway to web3," "unlock the power of decentralization."
- Don't call the migration flow "import a wallet" in any Wander-facing message — it's a named, specific migration path.
- Don't itemize or headline the underlying safety mechanics (recovery, permissions, previews) as marketed features or a proof-point checklist — they're incidental outcomes of a well-made simple wallet, not capabilities being sold. If it starts to read as "look how much this does," cut it.
- Stay competitor-silent to outsiders, fully — no naming a competitor, and no unnamed digs either ("what others get wrong," "unlike other wallets," "the bloat everyone else has"). Public messaging states what Gleam is and does; it never defines itself against another product, even implicitly. Competitor analysis stays internal (strategy.md, positioning.md) and informs decisions, not outward copy.
- Don't let "simple" read as "basic" — every simplicity claim should imply removed friction, not removed capability.
- Don't claim "open source" or "audit" as a headline trust badge — it's not the pitch; if it comes up at all, it's a quiet, secondary fact for anyone who goes looking.