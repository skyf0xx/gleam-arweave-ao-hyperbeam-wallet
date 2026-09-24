import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Root Vitest config, shared by every package/app in the workspace.
 * Test files are colocated with the code they test and suffixed with a
 * layer tag (e.g. `foo.vault.test.ts`), so `pnpm vitest run <fragment>`
 * can target one area by matching that fragment against file paths.
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.output/**", "**/.wxt/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
