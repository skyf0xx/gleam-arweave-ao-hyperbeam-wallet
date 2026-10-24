// @vitest-environment node
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
});
