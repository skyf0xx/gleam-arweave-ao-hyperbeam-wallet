// @ts-check
/**
 * Files past MAX_LINES, each capped with the reason it stays whole.
 * Prefer a split along a real seam (CLAUDE.md § One reason to change per
 * file), lowering or dropping the entry in the same commit. A file that is
 * one thing may raise its cap, with the reason updated beside it.
 */
export const MAX_LINES = 400;
/** @type {Record<string, number>} */
export const FILE_SIZE_CAPS = {
  // One view over one native page; every effect reads the same page state.
  "packages/app/src/screens/browser/src/BrowserView.tsx": 416,
  // One state machine over the pending approvals.
  "packages/runtime/src/handlers/approval.ts": 917,
  // What is left handles key material, which stays in the one file the signer fence allows.
  "packages/runtime/src/handlers/wallet-lifecycle.ts": 537,
};
