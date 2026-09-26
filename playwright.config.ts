import { defineConfig } from "@playwright/test";

/**
 * Smoke tests that load the built extension (`pnpm wxt:build` first).
 * Specs are `*.e2e.ts` so Vitest's `*.{test,spec}.ts` glob never picks
 * them up.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
});
