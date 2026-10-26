import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The page's CSP blocks Vite's HMR websocket, which the browser preview
// (`pnpm --filter @gleam/mobile dev`) needs. Dev server only: builds keep it.
const devCsp = {
  name: "gleam-dev-csp",
  apply: "serve" as const,
  transformIndexHtml: (html: string) => html.replace("connect-src https:", "connect-src https: ws://localhost:*"),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), devCsp],
  // Capacitor serves `dist/` from its own origin root on iOS and Android,
  // but relative URLs keep the bundle loadable from any path.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  // Matches the `type: "module"` the runtime worker is constructed with.
  worker: { format: "es" },
});
