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
  "packages/runtime/src/create-runtime.ts": 647,
  "packages/runtime/src/handlers/approval.ts": 1462,
  "packages/runtime/src/handlers/wallet-lifecycle.ts": 789,
  "apps/points-api/src/scans/attestations.ts": 586,
  "apps/site/scan-lib.js": 427,
  "packages/app/src/App.tsx": 451,
  "packages/app/src/approval/ApprovalRoot.tsx": 436,
  "packages/app/src/screens/main-screen/src/MainScreenView.tsx": 1149,
  "packages/app/src/screens/network-peers/src/NetworkPeersView.tsx": 513,
  "packages/app/src/screens/onboarding/src/OnboardingView.tsx": 419,
  "packages/app/src/screens/points/src/PointsView.tsx": 511,
  "packages/app/src/screens/send/src/SendView.tsx": 1408,
  "packages/app/src/transfer-review/TransferReview.tsx": 632,
  "packages/runtime/src/handlers/points.ts": 455,
  "packages/runtime/src/handlers/reads.ts": 980,
  "packages/ui/src/components/wallet/PortfolioChart.tsx": 403,
  "scripts/check-bundles.mjs": 434,
};
