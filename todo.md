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

The next three items finish the Vite 8 migration. Do them in order, one
commit each. Item 1's **Background** applies to all three.

- **Make `arweave` imports work under Vite 8's CommonJS interop.**
  `fix(core): …` M 🧪 `opus`

  **Background.** Dependabot PR #10 (`chore(deps): bump
  @vitejs/plugin-react from 5.2.0 to 6.1.1`, commit `3d80ec6`) needs
  `vite ^8`, so it moved the whole workspace from `vite@7.3.6` to
  `vite@8.3.0`. Compare `git show 3d80ec6~1:pnpm-lock.yaml | grep -E "^  vite@"`
  with the same command at `3d80ec6`. Vite 8 builds with Rolldown and
  deliberately changed how default imports from CommonJS packages work,
  to match esbuild. The Vite 8 migration guide calls this "Consistent
  CommonJS interop". The popup then failed to load with `Uncaught
  TypeError: u(...).default.init is not a function`.

  **Decision (made): stay on Vite 8.** Don't pin back to 7. WXT 0.21.4
  develops against `vite ^8.2.0` (its own `devDependencies`), so a pin is
  debt we'd pay again on the next upgrade. If a newer Vite major is out
  when this is picked up, move to whatever WXT's `devDependencies.vite`
  points at.

  **Root cause (verified).** `packages/core` is `"type": "module"`, so
  Rolldown wraps CommonJS packages imported from it in "Node mode"
  (`__toESM(mod, 1)`). In Node mode a default import is the whole
  `module.exports`, even when the package sets `__esModule`. `arweave`
  1.15.7 (CommonJS, `web/index.js`) puts its class on
  `module.exports.default`. So `import Arweave from "arweave"` now gives
  `{ default: Arweave, … }`, and `Arweave.init` is `undefined`.

  **Current state: hidden, not fixed.** Hotfix `3b70be2` made the client
  in `packages/core/src/keys/jwk.ts` lazy (`getArweave()`). The popup
  loads again only because the one thing it uses from `jwk.ts` is
  `validateJWKShape` (in `entrypoints/popup/onboarding/src/Import.tsx`),
  which never touches arweave. The import is still wrong in the popup
  build, so the next popup code that calls into arweave will crash. The
  comment above `getArweave()` blames an evaluation-order race. That's
  wrong; rewrite it. The background bundle happens to wrap arweave
  without Node mode, so it works there. Nobody knows why the two builds
  differ, so don't rely on it.

  **Reproduce first.** Nothing a user can do hits the bug today, so use
  this repro. It takes about a second.
  Put these three files in a scratch directory outside the repo:
  - `package.json` containing `{"type":"module"}`
  - `entry.js`: `import Arweave from "<repo>/node_modules/.pnpm/arweave@1.15.7/node_modules/arweave/web/index.js"; console.log(typeof Arweave.init);`
  - `vite.config.mjs`: `export default { build: { outDir: "out", minify: false, lib: { entry: "entry.js", formats: ["es"], fileName: "b" } } };`

  Build it with the repo's Vite:
  `node <repo>/node_modules/.pnpm/vite@8.3.0_*/node_modules/vite/bin/vite.js build`.
  Then `node out/b.js` prints `undefined`. That's the bug. The shim in the
  fix below prints `function` under the same build (verified).

  **Fix.**
  1. Add `packages/core/src/arweave/client.ts`, the one place that
     resolves the class under either interop mode. Sketch:

     ```ts
     import ArweaveImport from "arweave";
     type ArweaveClass = typeof ArweaveImport;
     // Vite 8 wraps CJS imports from a "type": "module" package in Node
     // mode, where the default import is all of module.exports.
     const mod = ArweaveImport as ArweaveClass | { default: ArweaveClass };
     export const Arweave: ArweaveClass = "init" in mod ? mod : mod.default;
     export type Arweave = InstanceType<ArweaveClass>;
     ```

     `vault/signing.ts` also uses `Arweave` as a type
     (`client: Arweave`, `Arweave["createTransaction"]`), so the type
     export matters. Run `pnpm tsc` on all four projects.
  2. Switch the three source imports to it:
     `packages/core/src/arweave/transfer.ts`,
     `packages/core/src/keys/jwk.ts`, `packages/core/src/vault/signing.ts`.
     The three `*.test.ts` files that import `arweave` directly can stay:
     Vitest doesn't use Node mode, which is also why the tests never
     caught this. Nothing mocks `arweave`.
  3. Add `client.shim.test.ts` next to it. It asserts
     `typeof Arweave.init === "function"` whether the import is the class
     or a `{ default }` wrapper; test both shapes by calling the resolver
     with each. Export the resolver as a function if that makes it
     testable.
  4. Keep or drop the lazy getter in `jwk.ts`, but fix its comment.
  5. Check the other CommonJS default imports:
     `git grep -n '^import [A-Za-z]* from "' -- packages apps | grep -v test`
     (currently `qrcode-generator`, `qr-code-styling`, `jsqr`, plus `react`
     and `react-dom`). A package has the same problem if its entry file
     sets `__esModule` and assigns `exports.default`. Test each suspect
     with the repro above. If any are affected, fix them the same way, or
     add them to **Unsorted** if they're out of scope.
  6. Look for Node-mode wraps in the built output. Plain `grep`/`ugrep`
     fail on the minified files, so use Node:
     `node -e 'const fs=require("fs");for(const f of ["background.js",...fs.readdirSync("chunks").map(x=>"chunks/"+x)])for(const m of fs.readFileSync(f,"utf8").matchAll(/\w+\(\w+\(\),1\)/g))console.log(f,m[0])'`
     Run it from `apps/extension/.output/chrome-mv3` after `pnpm wxt:build`.
     Expect several hits (about 8 today; React is wrapped this way too,
     and that's harmless). Only a wrap whose result is then read through
     `.default.<something>` is a problem. Look at the text around each
     hit to see which package it wraps.

  **Emergency lever, not the fix.** Setting
  `vite: () => ({ legacy: { inconsistentCjsInterop: true } })` in
  `apps/extension/wxt.config.ts` restores pre-8 behaviour. Use it only if
  something breaks in the field before this lands.

  **Manual check in Chrome** (load `apps/extension/.output/chrome-mv3`
  unpacked):
  - Open the popup.
  - Create a wallet.
  - Import a keyfile.
  - Send a small amount of AR.
  - Approve one dApp signing request.

  Between them these steps run `generateJWK`, `deriveAddress`,
  `transfer.ts` and `signing.ts`. Watch the popup, approval and
  service-worker consoles; any error fails the check.

- **CI smoke test: load the built extension and fail on runtime
  errors.** `ci: …` M `sonnet`

  CI (`.github/workflows/ci.yml`) already runs `pnpm wxt:build`, and that
  passed with the bundle that crashed the popup (see the item above).
  Vitest didn't catch it either. Only running the built extension shows
  this kind of bug.
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
  - Prove it works: set up the old crash (a top-level
    `Arweave.init({})` call in any module the popup imports) on a
    throwaway branch. The smoke test must fail on it.

- **Dependabot: give build-toolchain bumps their own group.**
  `ci(deps): …` S `sonnet`

  PR #10 changed the bundler while looking like a React plugin bump. See
  the first item above. In `.github/dependabot.yml`, add a group for
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
