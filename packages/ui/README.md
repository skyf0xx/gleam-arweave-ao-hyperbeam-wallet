# @gleam/ui

Gleam's shared design system: design tokens, low-level primitives
(buttons, cards, text fields), and wallet-specific components (token
rows, balance displays, onboarding screens). Every popup, side panel,
and approval-window screen in `apps/extension` is built from these
pieces rather than one-off markup. That's what keeps the wallet's UI
visually consistent.

This package renders UI only. It never imports background code
(`chrome.*`, `@webext-core/messaging`). Data arrives as props. A
component that needs wallet state gets it from `apps/extension`'s
hooks, which call the background through `@gleam/messaging`.

## Components

- [`tokens/`](#tokens) — the design token source of truth
- [`primitives/`](#primitives) — generic, app-agnostic building blocks
- [`components/wallet/`](#componentswallet) — wallet-domain display components
- [`components/onboarding/`](#componentsonboarding) — wallet creation/import flow components
- [`components/security-phrase/`](#componentssecurity-phrase) — the anti-phishing security phrase feature

### tokens/

- **`theme.css`** — defines every color, spacing, and typography value
  as a Tailwind 4 `@theme` block. There's no config file and no runtime
  style injection, which keeps it safe under MV3's content security
  policy. Values are sourced from the design mockups' own token sheet
  (see `DESIGN.md` at the repo root), so a hex literal never needs
  repeating outside this file.
- **`default-tokens.ts`** — defines the two tokens (AR, AO) the Tokens
  tab always shows regardless of balance data. It pulls the AO process
  id from `@gleam/core` rather than redefining it.

Tailwind 4's source auto-detection only walks from the Vite project root
(`apps/extension`). The `@source "../../src"` line in `theme.css` makes
this package an explicit scan root. Without it, utility classes used
only inside `packages/ui/src` are silently never generated.

### primitives/

Generic components with no wallet-specific knowledge: `Button`, `Card`/
`ListRow`, `TextField`, `FileDropzone`, `RiskNotice`, `EmptyState`,
`StatusDot`, `OptionSection`/`OptionRow`, `ScreenHeader`, and the `Beam`
brand mark.

`cn.ts` is the shadcn-convention class combinator (`clsx` +
`tailwind-merge`), extended to recognize `theme.css`'s custom
`text-caption`/`text-label`/etc. scale as a font-size group. Without
that extension, `tailwind-merge` misclassifies them as text-color and
drops conflicting classes incorrectly.

### components/wallet/

Components that know wallet domain shapes (`TokenBalance`, activity
entries, collectibles) but not where the data comes from: `TokenRow`,
`BalanceDisplay`, `ActivityRow`, `PortfolioChart`, `AddressDisplay`,
`QrCode`, `AccountAvatar`, `SendReceiveActions`, `CollectibleThumbnail`,
`NetworkErrorBanner`, `RecipientWarning`, and skeleton loading states.

These are the main screen's building blocks.

`MemorableAddress` renders a full address in emphasised 4-character
chunks (see `core/recipients/memorable-address.ts`), and `RecipientCard`
pairs it with the address's avatar and name wherever a send or signing
request names a recipient. Addresses use the bundled JetBrains Mono
(`tokens/fonts/`), which keeps l/I/1 and O/0 apart.

### components/onboarding/

Screens and pieces for wallet creation/import: `PasswordField`,
`PasswordStrengthMeter`, `StepDots` (progress indicator),
`AddressReveal`, and the onboarding-specific `BeamMark` variant.

### components/security-phrase/

The security phrase feature: an anti-phishing signal shown during
unlock (see the `SecurityPhrase` model in `@gleam/core`).

- An icon mark.
- A styled display.
- `SecurityPhrasePicker`, for choosing one.

## How it's used

`apps/extension`'s popup/side panel/approval screens compose these
primitives and wallet components, feeding them data fetched through
`@gleam/messaging` RPC calls. `@gleam/core` is this package's only
workspace dependency. It's used for model types (`TokenBalance`,
`SecurityPhrase`, etc.) and the AO token registry, never the reverse.
