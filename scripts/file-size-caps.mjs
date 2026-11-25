/**
 * Files past MAX_LINES when the limit came in, capped at their size then.
 * A cap may only come down: split the file (CLAUDE.md § One reason to
 * change per file) and lower or drop its entry in the same commit.
 */
export const MAX_LINES = 400;
/** @type {Record<string, number>} */
export const FILE_SIZE_CAPS = {
  "apps/site/gleam.js": 1716,
  "apps/site/program.js": 713,
  "eslint.config.js": 583,
  // One view over one native page; every effect reads the same page state.
  "packages/app/src/screens/browser/src/BrowserView.tsx": 416,
  "packages/runtime/src/create-runtime.ts": 415,
  // One state machine over the pending approvals; the grant methods could move out (todo.md).
  "packages/runtime/src/handlers/approval.ts": 981,
  // What is left handles key material, which stays in the one file the signer fence allows.
  "packages/runtime/src/handlers/wallet-lifecycle.ts": 566,
  "apps/site/scan-lib.js": 427,
  "scripts/check-bundles.mjs": 434,
};
