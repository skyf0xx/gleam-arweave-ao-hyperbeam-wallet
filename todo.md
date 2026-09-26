# Gleam — todo

Ordered: work top to bottom. One item per commit. When an item is done,
delete it from this file in the same commit. Add anything newly found
under **Unsorted** with a file path and a one-line reason.

Tags: size **S/M/L**. 🧪 = needs a manual check in Chrome. ❓ = needs a
product decision before starting.
The last tag is the model the subagent should run on: `opus` for signing,
vault, crypto and provider security; `sonnet` for everything else.

## Not planned

- Wander's deprecated `{ algorithm, hash, salt }` encrypt/decrypt stays
  refused (`provider-params.ts` `readEncryptAlgorithm`). Wander deprecated
  it and no dApp has asked for it. Wander's source specifies it fully if
  that changes.
- `userTokens` doesn't set `Logo` (`reads.ts`): `TokenBalance` doesn't
  carry the spawn-tag logo, and no dApp has asked for it.
- Upload is disabled in Settings until bundler uploads work with current
  AO wallets; re-enabling means restoring the row's `onOpenUpload` wiring.

## Unsorted

<!-- New findings go here until they're placed in the list above. -->

The next two items keep the Vite 8 upgrade from breaking the extension
without anyone noticing again. Do them in order, one commit each.

**Background (applies to both).** Dependabot PR #10 (`chore(deps): bump
@vitejs/plugin-react from 5.2.0 to 6.1.1`, commit `3d80ec6`) needs
`vite ^8`, so it moved the whole workspace from `vite@7.3.6` to
`vite@8.3.0`. Vite 8 builds with Rolldown and changed how default imports
from CommonJS packages work (Vite 8 migration guide: "Consistent CommonJS
interop"). In the built extension, `import Arweave from "arweave"`
started returning `{ default: Arweave }`, and the popup failed to load
with `Uncaught TypeError: u(...).default.init is not a function`. That's
fixed: every source file now imports `Arweave` from
`packages/core/src/arweave/client.ts`, which accepts either shape. The
two items below are about catching the next bug like it before it
ships. We're staying on Vite 8; don't pin back to 7.

- **CI smoke test: load the built extension and fail on runtime
  errors.** `ci: …` M `sonnet`

  CI (`.github/workflows/ci.yml`) already runs `pnpm wxt:build`, and that
  passed with the bundle that crashed the popup. Vitest didn't catch it
  either: tests don't go through Rolldown's production interop. Only
  running the built extension shows this kind of bug.
  - Playwright isn't installed. Add `@playwright/test` as a root
    devDependency. In CI, run
    `pnpm exec playwright install --with-deps chromium`.
  - Extensions only load in a persistent context:
    `chromium.launchPersistentContext("", { args:
    ["--disable-extensions-except=<abs path to .output/chrome-mv3>",
    "--load-extension=<same>"] })`. Check the current Playwright docs
    ("Chrome extensions") for headless support and the exact `channel`
    option.
  - Get the extension ID from the service worker URL
    (`context.serviceWorkers()`, or `waitForEvent("serviceworker")`).
  - Open `chrome-extension://<id>/popup.html` and `.../approval.html`.
    Fail on any `pageerror`, any `console` error, or any error logged by
    the service worker.
  - Add it as a CI job step after `pnpm wxt:build`. Add a `pnpm` script
    so it can also run locally.
  - Prove it works on a throwaway branch: recreate the original crash by
    adding `import RawArweave from "arweave"; RawArweave.init({});` at the
    top level of a module the popup imports, for example
    `packages/core/src/keys/jwk.ts`. It must import from `"arweave"`
    directly, not from `client.ts`, which handles the Vite 8 interop.
    `pnpm wxt:build` still passes. The smoke test must fail with
    `.default.init is not a function` or `init is not a function`.

- **Dependabot: give build-toolchain bumps their own group.**
  `ci(deps): …` S `sonnet`

  PR #10 changed the bundler while looking like a React plugin bump (see
  **Background** above). In `.github/dependabot.yml`, add a group for
  `vite`, `@vitejs/*`, `wxt`, `@wxt-dev/*`, `rolldown`,
  `@tailwindcss/vite` and `vite-plugin-node-polyfills`, so these arrive
  as one clearly labelled PR. Check that the existing `npm-minor-patch`
  group doesn't also claim these packages; Dependabot applies the first
  group that matches. Add a comment in the file saying that majors in
  this group need the manual Chrome check before merging.

- `arweave` is pinned to 1.15.7; the 2.1.0 bump (Dependabot PR #14, closed)
  breaks `Transaction.get`/`createTransaction` — `b64UrlToBuffer` throws
  `InvalidCharacterError`, hit directly by `submitTransfer`
  (`packages/core/src/arweave/transfer.ts:61`) and caught by
  `transfer.arweave.test.ts` + `transfer.send.test.ts`. Upgrading needs a
  real pass: read arweave-js's v2 migration notes, adapt `transfer.ts`,
  re-test AR sends manually in Chrome. M 🧪 `opus`

- Chrome Web Store: not yet submitted. First submission is manual (Developer
  Dashboard, $5 one-time registration, store listing copy/screenshots,
  privacy-practices disclosures, and a manual review pass since this is a
  wallet). Once that first listing exists and has an extension ID, add a
  tag-triggered release workflow (`chrome-webstore-upload` API, secrets:
  `EXTENSION_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`) so future
  releases are a version-tag push. S ❓ `sonnet`

- `packages/core/src/arweave/graphql.ts:37` — GraphQL falls back to
  `arweave-search.goldsky.com`, but `apps/extension/wxt.config.ts` grants no
  host permission for it, so the fallback may fail from the service worker.
  Verify, then add the permission or drop the fallback. S 🧪 `sonnet`
