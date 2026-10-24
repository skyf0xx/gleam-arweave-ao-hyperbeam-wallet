import type { CapacitorConfig } from "@capacitor/cli";

// No `server.url`: the app loads only the bundled `dist/`, so code
// reaches users only through signed store releases
// (`capacitor.config.mobile.test.ts`).
const config: CapacitorConfig = {
  appId: "app.gleamwallet",
  appName: "Gleam",
  webDir: "dist",
};

export default config;
