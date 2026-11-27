import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { TimedSequencer } from "./scripts/test-shards.ts";

const EXCLUDE = ["**/node_modules/**", "**/.output/**", "**/.wxt/**", "**/.claude/worktrees/**", "**/.stryker-tmp/**"];

// Code that never touches a DOM. Setting up jsdom costs each test file a
// noticeable share of the run; a file here that does need it says so with
// `// @vitest-environment jsdom`.
const NODE_TESTS = [
  "packages/core/**/*.test.ts",
  "packages/runtime/**/*.test.ts",
  "packages/messaging/**/*.test.ts",
  "apps/points-api/**/*.test.ts",
  "scripts/**/*.test.ts",
  "security/**/*.test.ts",
  "docs/**/*.test.ts",
];

/**
 * Root Vitest config, shared by every package/app in the workspace.
 * Test files are colocated with the code they test and suffixed with a
 * layer tag (e.g. `foo.vault.test.ts`), so `pnpm vitest run <fragment>`
 * can target one area by matching that fragment against file paths.
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    exclude: EXCLUDE,
    setupFiles: ["./vitest.setup.ts"],
    // CI shards split by recorded time (scripts/test-timings.json).
    sequence: { sequencer: TimedSequencer },
    // Each points-api test file boots PGlite (~3s, more on a busy machine).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      { extends: true, test: { name: "node", environment: "node", include: NODE_TESTS } },
      {
        extends: true,
        test: { name: "dom", environment: "jsdom", include: ["**/*.{test,spec}.{ts,tsx}"], exclude: [...EXCLUDE, ...NODE_TESTS] },
      },
    ],
  },
});
