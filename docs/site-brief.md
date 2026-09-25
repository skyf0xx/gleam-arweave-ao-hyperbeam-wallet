# Build brief: Gleam website

You're building the public website for Gleam, a Chrome extension wallet for
Arweave and AO. It's three static pages hosted free on GitHub Pages. Every
decision below is final. Build what this says. Where something isn't
covered, follow the brand sources in §11, and choose the less decorated
option.

**This task overrides the repo's normal workflow.** `CLAUDE.md` tells you to
take the top item in `todo.md`. Don't. This brief is the task. Don't touch
`packages/`, `apps/extension/` or `todo.md`, apart from the one ESLint change
in §9.

---

## 1. Deliverables

All under `apps/site/`, which is already partly populated (§2):

| File | What |
|---|---|
| `index.html` | The one-pager (§4) |
| `privacy.html` | Privacy policy (§7). Its URL goes into the Chrome Web Store listing, so it must be accurate. |
| `terms.html` | Terms of use (§7) |
| `styles.css` | One stylesheet shared by all three pages |
| `main.js` | Small vanilla JS for motion (§6). Index only. |
| `.nojekyll` | Empty file |
| `.github/workflows/pages.yml` | Deploy workflow (§8), at the **repo root**, not in `apps/site` |

Constraints:
- **No framework, no bundler, no build step, no npm dependencies.** Hand-written HTML, CSS and JS only.
- `apps/site/` must **not** become a pnpm workspace package. Don't give it a `package.json`.
- **Zero third-party requests.** No Google Fonts, CDNs, analytics or embeds. The privacy policy states this, so the site has to be true to it.
- **Relative URLs everywhere** (`img/…`, `privacy.html`). The site is served from a sub-path: `https://skyf0xx.github.io/gleam-arweave-ao-hyperbeam-wallet/`.
- **Light theme only.** Set `<meta name="color-scheme" content="light">` and `color-scheme: light`. The product renders are all lit on white, and a dark page around them breaks the look.

## 2. Assets already prepared (don't regenerate)

```
apps/site/
  favicon.svg            extension mark (hexagon). Also the header logo mark.
  favicon-32.png
  apple-touch-icon.png   128px
  fonts/inter-var-latin.woff2            Inter variable (wght 100–900)
  fonts/jetbrains-mono-var-latin.woff2   JetBrains Mono variable
  fonts/OFL-*.txt                        font licences (keep them)
  img/og.jpg             1200×630 social card
  img/<name>-<width>.webp
```

| Image | Intrinsic sizes | Shows | Used in |
|---|---|---|---|
| `dashboard-hero` | 1004×1365, 502×683 | Wallet home, crisp, portrait, slight tilt | Hero |
| `review-send` | 1200×896, 600×448 | "Review send": amount, full recipient address, fee, Sign and send | Showcase 1 |
| `activity-pending` | 1200×896, 600×448 | Activity tab: pending send with beam progress bar | Showcase 2 |
| `network-peers` | 1200×896, 600×448 | Network & peers: arweave.net gateway, AO peer | Showcase 3 |
| `dashboard-front` | 1200×896, 600×448 | Wallet home, front-facing, floating | Final CTA |

Each render is a white product card floating on a near-white backdrop
(`#E5E5E5`–`#FFFFFF`) with its shadow baked in. The card fills roughly the
middle 40–60% of the frame. Use them like this:

- `<img srcset="… 600w, … 1200w" sizes="…" width height alt loading decoding>`. Set `width`/`height` so there's no layout shift. Give the hero image `fetchpriority="high"` and add a matching `<link rel="preload" as="image" imagesrcset imagesizes>`. Lazy-load all the others.
- **Fade every image's edges into the page** with a radial mask so the backdrop never shows as a rectangle:
  `mask-image: radial-gradient(closest-side, #000 72%, transparent 100%)`. Tune the stops per image by eye. The card and its shadow must stay fully opaque. Only the empty backdrop fades.
- **Mobile crop:** below 640px the card would be tiny inside a 1200×896 frame. Wrap each landscape image in a box with `aspect-ratio: 4 / 5; overflow: hidden` and give the image `object-fit: cover; object-position: center`, scaled up (e.g. `width: 150%` centred) so the card fills most of the width. Check that no card is ever clipped.
- Use only the prepared files in `apps/site/img/`. Never reference `docs/branding/images/`, which holds the full-size sources. Files there prefixed `unusable-` have garbled AI text, invented tokens, or show features that haven't shipped. They must never appear on the site.
- Sources of the prepared images, for any future re-export: `dashboard-hero` ← `dashboard-tilted-crisp.png`, `review-send` ← `review-send-front.png`, `activity-pending` ← `activity-pending-send-tilted.png`, `network-peers` ← `network-peers-front.png`, `dashboard-front` and `og.jpg` ← `dashboard-floating-front.png`.

## 3. Design tokens

```css
@font-face { font-family: "Inter"; src: url("fonts/inter-var-latin.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("fonts/jetbrains-mono-var-latin.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }

:root {
  --bg: #F7F7F7;        /* page. Matched to the renders' backdrops; not pure white */
  --fg: #111111;        /* Gleam Black: text, primary button */
  --muted: #5E5E5E;     /* secondary text. Brand #737373 fails AA on --bg at small sizes */
  --line: #E5E5E5;
  --beam-red: #FF1717; --beam-purple: #8B12FF; --beam-sky: #73C9E8; --beam-yellow: #FFE45C; --beam-green: #28F02D;
  --sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, monospace;
  --radius: 12px;
  --gutter: clamp(16px, 5vw, 64px);
  --max: 1200px;
}
```

Type:
- **Display** (hero and final headline): Inter 600, `clamp(2.75rem, 6.5vw, 5.75rem)`, line-height 1.02, letter-spacing −0.035em, `text-wrap: balance`.
- **Section heading**: 600, `clamp(1.75rem, 3.6vw, 3rem)`, line-height 1.1, letter-spacing −0.025em.
- **Body / lines**: 400, `clamp(1.0625rem, 1.4vw, 1.25rem)`, line-height 1.5, `--muted`.
- **Small** (captions, footer): 400, 0.875rem.
- Sentence case everywhere. No all-caps, no letter-spaced eyebrows.

Components:
- **Wordmark**: `favicon.svg` at 22px, 8px gap, then the lowercase text `gleam` in Inter 600, 1.25rem, letter-spacing −0.02em, colour `--fg`. It's always lowercase.
- **Primary button**: `--fg` background, white text, Inter 500 1rem, height 48px, padding 0 22px, `--radius`. Hover: `#000` plus a 1px lift. Visible 2px focus ring offset 3px in `--fg`. It's a real `<a>`.
- **The beam**: five equal hard-edged segments in the order red, purple, sky, yellow, green. **No gradient blending between colours.** Build it as a flex row of five spans or with hard stops (`linear-gradient(90deg, var(--beam-red) 0 20%, var(--beam-purple) 20% 40%, …)`). It's 3px tall. It appears **exactly once** as a UI element: a 72px-wide beam under the final CTA headline. Colour is scarce on purpose. Don't add more beams.
- No cards around text, no borders around sections, no background colour changes between sections. The whole page is one continuous `--bg` space.

## 4. `index.html`: structure and copy

There's no navigation. The page runs hero → three showcases → final CTA →
footer. Use the copy **exactly as written**. It follows the brand voice (§11).

**Header** (not sticky, not a nav): the wordmark top-left, linking to `./`.
Nothing on the right.

**Hero** (min-height ~90svh; two columns on desktop, stacked on mobile with the text first)
- `<h1>` Crypto without the clutter.
- Line: Your wallet for AO and Arweave. Open it, do the thing, done.
- Primary button: **Follow @gleam_wallet** → `https://x.com/gleam_wallet` (`rel="noopener"`, same tab).
- Caption under the button, small and muted: Coming to the Chrome Web Store.
- Image: `dashboard-hero`, large. Desktop: the right column, about 45–50% of the width, allowed to be taller than the text column. Alt: "Gleam wallet home screen showing a $2.14 balance, a 7-day chart, Send and Receive buttons, and AR and AO token balances."

**Showcase sections** (each at least ~80svh with generous vertical padding, ~20–30vh between sections). Each one has a single large image and a short text block (heading + one line). Alternate the image side on desktop: image right, then left, then right. On mobile, stack the text first. Vertically centre the text against the image.

1. `<h2>` See what you're sending.
   Line: The amount, the full address and the fee, before you sign.
   Image `review-send`. Alt: "Review send screen: 0.002 AO to a full, untruncated recipient address, no network fee, and a Sign and send button."
2. `<h2>` Everything at a glance.
   Line: Balances and activity for AR and AO in one view. A send shows its progress until it confirms.
   Image `activity-pending`. Alt: "Activity tab showing a pending 0.002 AO send with a progress bar, above an earlier confirmed send."
3. `<h2>` Built for AO.
   Line: Arweave and AO, and nothing else. No network switcher, no chain list.
   Image `network-peers`. Alt: "Network and peers settings showing the arweave.net gateway and an active AO peer."

**Final CTA** (centred, lots of empty space above and below)
- Image `dashboard-front`, centred, with the refraction line (§6) passing behind it. Alt: "Gleam wallet home screen."
- `<h2>` (Display size) Crypto without the clutter.
- The beam (72×3px), centred, 24px below the headline.
- The same primary button and caption as the hero.

**Footer** (one quiet row, small, muted, a 1px `--line` rule above it; it wraps on mobile)
`gleam` wordmark (text only, no mark) · Privacy (`privacy.html`) · Terms (`terms.html`) · GitHub (`https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet`) · X (`https://x.com/gleam_wallet`) · © 2026 Gleam

**`<head>`**: `<title>Gleam: crypto without the clutter</title>`, meta description "Gleam is a wallet for AO and Arweave. Open it, do the thing, done.", the three favicon links, a `theme-color` of `#F7F7F7`, and Open Graph plus Twitter tags (`summary_large_image`, `twitter:site` `@gleam_wallet`, image `img/og.jpg`). Use the absolute Pages URL for `og:image` and `og:url`: `https://skyf0xx.github.io/gleam-arweave-ao-hyperbeam-wallet/`. Use semantic landmarks (`header`, `main`, `section` with `aria-labelledby`, `footer`).

## 5. Copy rules (for anything you have to write yourself)

Sentence case. Contractions. No exclamation marks. Never use: seamless,
revolutionary, next-gen, unlock, empower, bank-grade, secure/security as a
selling point, "web3", "join", or anything about "the future". Never mention
or allude to another wallet. Don't list features or safety mechanics.
"Open source" appears only as the footer's GitHub link. If a sentence can be
cut, cut it.

## 6. Motion (`main.js` + CSS)

The effect should be barely perceptible, like a photographed object, not a
UI demo.

- **Float**: each image wrapper translates Y by ±3px (never more than 4px, because the baked-in shadow moves with it) using `ease-in-out` over 7s, 8.5s, 9.5s and 10s. Give each element a different duration and a negative `animation-delay` so they never move in sync. Pure CSS.
- **Reveal**: when a section first enters the viewport (IntersectionObserver, `threshold: 0.2`), its text and image fade from 0 to 1 opacity and rise 16px over 900ms `cubic-bezier(.2,.7,.2,1)`, with the image following 120ms after the text. It runs once. Without JS, everything must be visible: add a `js` class to `<html>` from script and gate the hidden state behind `.js`.
- **Glint** (optional, and cut it if it reads as a shimmer): every 12–20s at a random interval, one currently visible showcase image gets a narrow diagonal highlight sweeping across it over 1.6s. Build it as a pseudo-element with a band of `rgba(255,255,255,.0)` → a faint spectral edge at ~6–8% opacity using the beam colours → transparent, with `mix-blend-mode: soft-light`, inside the image's masked wrapper. Only one glint on the page at a time.
- **Refraction line** (final CTA only): behind the `dashboard-front` image, draw five parallel 2px lines in the beam colours at ~30% opacity, touching each other with hard edges and no blur. Run them diagonally across the section at about −28°, from off-screen left to off-screen right. It should read as a thin beam of split light passing behind the object. It must not read as a rainbow graphic. On pointer-capable devices (`matchMedia('(pointer: fine)')`), shift it up to ±6px following the cursor, eased with `requestAnimationFrame`.
- **`prefers-reduced-motion: reduce`**: no float, no glint, no pointer tracking, and reveals show instantly.
- Pause float and glint when the tab is hidden (`visibilitychange`).

## 7. `privacy.html` and `terms.html`

Use the same header and footer as `index.html`. The content goes in a single
readable column (max-width ~680px, body 1.0625rem, line-height 1.65,
headings in the §3 scale). Show "Last updated: 25 September 2026" under the
`<h1>`. Put domains in `<code>` (JetBrains Mono). Write in the brand voice:
plain and specific, with no legalese padding.

**Before writing the privacy page, verify every network destination against
the code.** Read `apps/extension/wxt.config.ts` (`host_permissions`),
`packages/core/src/arweave/*` (the gateway, GraphQL fallbacks and
`FALLBACK_GATEWAY_URLS`), `packages/core/src/ao/*` (MU/CU),
`packages/core/src/pricing/*`, and `DEFAULT_HYPERBEAM_PEER_URLS`. List exactly
what the code calls, check what each request contains (for example, whether
price requests include the wallet address), and state it accurately. The list
as of this brief:

- Arweave gateways, `arweave.net` by default: balances, activity (GraphQL), transaction posts. First-run reachability checks go to `ar-io.dev` and `permagate.io`. GraphQL falls back to `arweave-search.goldsky.com`.
- `up.arweave.net`: data uploads.
- `mu.ao-testnet.xyz`: submitting AO messages (token sends). `cu.ao-testnet.xyz`: reading results.
- HyperBEAM peers, `state.forward.computer` by default, plus any peer you add: AO balance reads.
- `api.coingecko.com`, `api.coinpaprika.com`: token prices for USD values.
- `lunar.arweave.net`: a block explorer, opened in a new tab only when you click a transaction or address.

**Privacy: sections and facts** (turn these into short prose, one short section each):
1. *What Gleam is*: a browser extension wallet, plus this website. There's no Gleam server or account.
2. *What stays on your device* (confirm against `packages/core/src/vault/` and `apps/extension/src/handlers/key-session.ts`): your key is encrypted with your password and stored in the browser's extension storage. While the wallet is unlocked, the decrypted key is held in session storage and is cleared on lock or browser restart. Settings, contacts, connected-site grants and a local activity log are stored locally too. None of it is sent to us. We have no server to send it to.
3. *What we can't see*: your key, password, balances, addresses or activity. We can't recover a lost password or key.
4. *Network requests the extension makes*: the verified list above, each with its purpose. Say plainly that these services receive your IP address, and that the gateways and AO nodes receive your public address when looking up balances and activity, because that's how public blockchains work. Transactions you send are public and permanent on Arweave/AO.
5. *Sites you connect*: a site sees only what you grant (e.g. your address). Signing requests open an approval window. You can revoke a site's access at any time in Connected apps.
6. *No tracking*: no analytics, telemetry, cookies, ads or third-party scripts, in the extension or on this website. The website is static and hosted on GitHub Pages. GitHub may log standard request data (link to GitHub's privacy statement: `https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement`).
7. *Changes*: updates are posted on this page with a new date. The code is public (GitHub link).
8. *Contact*: `gleam.wallet@proton.me`.

**Terms: sections and facts:**
1. *Using Gleam*: Gleam is self-custody software. You hold your key, and you're responsible for your password and backups.
2. *No recovery by us*: we can't access, reset or recover your key, password or funds.
3. *Transactions are final*: transactions on Arweave and AO can't be reversed. Check the recipient and amount before you sign.
4. *Third-party services*: gateways, AO nodes, price sources and the sites you connect are run by others. We don't control their availability or accuracy, and displayed prices are estimates.
5. *Not financial advice*: Gleam is a tool, not a financial service, broker, exchange or adviser.
6. *Licence and warranty*: the software is provided "as is", without warranty, under the MIT License (link to `LICENSE` on GitHub: `https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/blob/master/LICENSE`). To the extent the law allows, we're not liable for losses arising from using it.
7. *Changes*: we may update these terms, and changes are posted here with a new date.
8. *Contact*: `gleam.wallet@proton.me`.

## 8. Deploy workflow

Create `.github/workflows/pages.yml` exactly as follows:

```yaml
name: Deploy site

on:
  push:
    branches: [master]
    paths: ["apps/site/**", ".github/workflows/pages.yml"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: apps/site
      - id: deployment
        uses: actions/deploy-pages@v4
```

The repo owner has to switch **Settings → Pages → Source** to **GitHub
Actions** once. You can't do that. Mention it in the PR description.

## 9. Repo hygiene

- The pre-commit hook (lefthook) runs ESLint on staged `*.js` files, and the root `eslint.config.js` doesn't know browser globals, so `apps/site/main.js` will fail on `window` and `document`. Add one config block scoped to `apps/site/**/*.js` that sets browser globals. Use the `globals` package if it's already resolvable from the root. Otherwise list the handful of globals you use. Don't disable rules.
- Don't bypass hooks (`--no-verify`).
- Work on a branch named `site`. Use Conventional Commits, e.g. `feat(site): add landing page`, `feat(site): add privacy and terms pages`, `ci(site): deploy apps/site to GitHub Pages`, `chore(eslint): browser globals for apps/site`.
- Open a PR to `master`. In the description: what was built, the Pages setting step from §8, and any place where you departed from this brief, with the reason.

## 10. Verify before opening the PR

Serve locally with `python3 -m http.server -d apps/site 8080` (or any static
server).

If a headless browser is available (e.g. Playwright), screenshot `index.html`
at **1440×900**, **768×1024** and **390×844**, plus `privacy.html` at 390, and
look at the screenshots yourself. If a check fails, fix it and screenshot
again.

- No horizontal scroll at 360px. Every card is fully visible and never clipped by the mobile crop. No image shows a rectangular backdrop edge.
- The hero headline, line, button and image are all above the fold at 1440×900.
- No console errors. No network request leaves the origin (check the network log).
- All links resolve. Tab through the page: focus rings are visible and the order is logical.
- With reduced motion emulated, nothing moves.
- Text contrast is at least 4.5:1 (`--muted` on `--bg` passes; don't lighten it).
- Total page weight on first load is under 400 KB.

If no browser is available, say so in the PR and list what you couldn't check.

## 11. Brand sources (only if something isn't covered here)

- `docs/branding/brand/voice.md`: tone, banned words
- `docs/branding/brand/guidelines.md`: colour ratios, beam rules, typography
- `docs/branding/brand/identity.md`: imagery rules
- `docs/branding/details.md`: the original art direction ("Apple product launch × minimalist industrial design × subtle prismatic light"; each section should feel like a product photograph in an exhibition)

Where those files disagree with this brief, the brief wins. It has already
resolved their conflicts: the headline, the lowercase wordmark, the
page colour, and the CTA while the extension isn't in the store yet.
