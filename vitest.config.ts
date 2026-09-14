import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Root Vitest config, shared by every package/app in the workspace.
 * Each layer's `verify` in `.hedgehog/core.yaml` runs `pnpm vitest run
 * <name-fragments>` — Vitest matches those fragments against test file
 * paths, so each layer's tests live under a directory or filename
 * carrying its layer id (e.g. `scaffold`, `ui`, `messaging`, `vault`).
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.output/**", "**/.wxt/**"],
  },
});
