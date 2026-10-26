import type { CapacitorConfig } from "@capacitor/cli";

// No `server.url`: the app loads only the bundled `dist/`, so code
// reaches users only through signed store releases
// (`capacitor.config.mobile.test.ts`).
const config: CapacitorConfig = {
  appId: "app.gleamwallet",
  appName: "Gleam",
  webDir: "dist",
  plugins: {
    // Library/CapacitorDatabase is created excluded from iCloud and device
    // backups; the default, Documents, is backed up. The vault is already
    // sealed under the user's password, so the database isn't encrypted again.
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
  },
};

export default config;
