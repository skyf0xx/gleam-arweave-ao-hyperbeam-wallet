// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "./capacitor.config";
import packageJson from "./package.json";

// Over-the-air update plugins would let a server push code past store
// signing (docs/MOBILE.md, "No remote code").
const LIVE_UPDATE_PACKAGE = /updater|live-?updates?|code-?push|hot-?update|cordova-plugin-ionic|appflow|revopush|capawesome.*update/i;

describe("capacitor.config", () => {
  it("loads only the bundled assets, never a server URL", () => {
    expect(config.server?.url).toBeUndefined();
    expect(config.webDir).toBe("dist");
  });

  it("installs no live-update plugin", () => {
    const installed = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
    expect(installed.filter((name) => LIVE_UPDATE_PACKAGE.test(name))).toEqual([]);
    expect(Object.keys(config.plugins ?? {}).filter((name) => LIVE_UPDATE_PACKAGE.test(name))).toEqual([]);
  });

  // The database holds the sealed vault; a backup would expose it to
  // offline password guessing.
  it("keeps the wallet database out of backups", () => {
    expect(config.plugins?.CapacitorSQLite?.iosDatabaseLocation).toBe("Library/CapacitorDatabase");

    const res = new URL("./android/app/src/main/", import.meta.url);
    const manifest = readFileSync(new URL("AndroidManifest.xml", res), "utf8");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');

    const rules = readFileSync(new URL("res/xml/data_extraction_rules.xml", res), "utf8");
    for (const section of ["cloud-backup", "device-transfer"]) {
      const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] ?? "";
      expect(body).not.toContain("<include");
      for (const domain of ["root", "file", "database", "sharedpref", "external"]) {
        expect(body).toContain(`<exclude domain="${domain}" path="." />`);
      }
    }
  });

  // Android FLAG_SECURE blocks screenshots and blanks the recents card; iOS
  // covers the window in the app switcher. Both come from native config, so
  // no JS path can leave them off. iOS's layer-reparenting screenshot block
  // stays off.
  it("keeps the privacy screen on from startup", () => {
    expect(config.plugins?.PrivacyScreen?.enable).toBe(true);
    expect(config.plugins?.PrivacyScreen?.preventScreenshots).toBe(false);
    expect(packageJson.dependencies["@capacitor-community/privacy-screen"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // Landscape makes Android show its rotate-suggestion button over the app.
  it("locks the phone to portrait", () => {
    const manifest = readFileSync(new URL("android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
    expect(manifest).toContain('android:screenOrientation="portrait"');

    const plist = readFileSync(new URL("ios/App/App/Info.plist", import.meta.url), "utf8");
    const phone = plist.match(/<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? "";
    expect([...phone.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1])).toEqual(["UIInterfaceOrientationPortrait"]);
  });
});
