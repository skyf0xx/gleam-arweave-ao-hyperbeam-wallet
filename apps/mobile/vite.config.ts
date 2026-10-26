import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { build, defineConfig, type Plugin } from "vite";

// The page's CSP blocks Vite's HMR websocket, which the browser preview
// (`pnpm --filter @gleam/mobile dev`) needs. Dev server only: builds keep it.
const devCsp = {
  name: "gleam-dev-csp",
  apply: "serve" as const,
  transformIndexHtml: (html: string) => html.replace("connect-src https:", "connect-src https: ws://localhost:*"),
};

const PROVIDER_SCRIPT_ID = "virtual:gleam-provider-script";

/**
 * Builds `src/provider/index.ts` into one IIFE and hands it to the app as a
 * string, which native injects into dApp pages. It is a separate build
 * because the page needs a single classic script with nothing to load, and
 * Android wraps it in a block (`if (window === window.top) { … }`), where
 * an IIFE is still valid.
 */
const providerScript: Plugin = {
  name: "gleam-provider-script",
  resolveId: (id) => (id === PROVIDER_SCRIPT_ID ? `\0${PROVIDER_SCRIPT_ID}` : null),
  async load(id) {
    if (id !== `\0${PROVIDER_SCRIPT_ID}`) return null;
    const entry = fileURLToPath(new URL("./src/provider/index.ts", import.meta.url));
    this.addWatchFile(entry);
    const result = await build({
      configFile: false,
      root: fileURLToPath(new URL(".", import.meta.url)),
      publicDir: false,
      logLevel: "warn",
      build: {
        write: false,
        minify: true,
        // Each page gets the provider inline; a source map would only add bytes.
        sourcemap: false,
        rolldownOptions: { input: entry, output: { format: "iife", codeSplitting: false } },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((output) => ("output" in output ? output.output : [])).filter((file) => file.type === "chunk");
    if (chunks.length !== 1 || !chunks[0]) throw new Error("The provider script must build to exactly one chunk.");
    return `export default ${JSON.stringify(chunks[0].code)};`;
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), devCsp, providerScript],
  // Capacitor serves `dist/` from its own origin root on iOS and Android,
  // but relative URLs keep the bundle loadable from any path.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  // Matches the `type: "module"` the runtime worker is constructed with.
  worker: { format: "es" },
});
