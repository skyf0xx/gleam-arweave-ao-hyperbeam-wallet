# @gleam/ui

This package is Gleam's component library, in the style of shadcn/ui. It
contains the design tokens and components that every screen in
`@gleam/app` is assembled from, which keeps the wallet consistent
everywhere.

The components are presentational: a screen passes them data as props,
and they never talk to the background themselves.

## Structure

- **`tokens/`**: the colors, spacing, typography and fonts, defined in
  `theme.css` and based on `DESIGN.md` at the repo root.
- **`primitives/`**: general-purpose components such as `Button`,
  `Card`, `TextField` and `ScreenHeader`.
- **`components/wallet/`**: components for showing wallet information,
  such as `TokenRow`, `BalanceDisplay`, `ActivityRow`, `QrCode` and
  `RecipientCard`.
- **`components/onboarding/`**: pieces of the flow for creating or
  importing a wallet, such as the password field and its strength meter.
- **`components/security-phrase/`**: the security phrase, a personal
  anti-phishing signal that the user sees whenever they unlock.

## Where it sits

```text
@gleam/core (types) → @gleam/ui (components) → @gleam/app (screens)
```
