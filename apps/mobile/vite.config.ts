import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Capacitor serves `dist/` from its own origin root on iOS and Android,
  // but relative URLs keep the bundle loadable from any path.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
