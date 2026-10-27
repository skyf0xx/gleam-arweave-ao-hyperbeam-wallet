import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const registerPlugin = vi.hoisted(() => vi.fn((name: string) => ({ name })));
vi.mock("@capacitor/core", () => ({ registerPlugin }));

import { DAPP_VIEW_EVENT, DAPP_VIEW_HANDLER, DappView } from "./index";

const SWIFT_DIR = resolve(__dirname, "../ios/Sources/DappViewPlugin");
const swift = readdirSync(SWIFT_DIR)
  .filter((file) => file.endsWith(".swift"))
  .map((file) => readFileSync(resolve(SWIFT_DIR, file), "utf8"))
  .join("\n");

const KOTLIN_DIR = resolve(__dirname, "../android/src/main/java/app/gleamwallet/dappview");
const kotlin = readdirSync(KOTLIN_DIR)
  .filter((file) => file.endsWith(".kt"))
  .map((file) => readFileSync(resolve(KOTLIN_DIR, file), "utf8"))
  .join("\n");

// The TypeScript API and the native code meet only through these strings,
// so a rename on either side would fail silently on a device.
describe("dApp view plugin", () => {
  it("registers under the native plugin's jsName", () => {
    expect(DappView).toEqual({ name: "DappView" });
    expect(swift).toContain('jsName = "DappView"');
    expect(kotlin).toContain('@CapacitorPlugin(name = "DappView")');
  });

  it("names the page channel and reply event the native code uses", () => {
    expect(swift).toContain(`handlerName = "${DAPP_VIEW_HANDLER}"`);
    expect(swift).toContain(`pageEvent = "${DAPP_VIEW_EVENT}"`);
    expect(kotlin).toContain(`HANDLER_NAME = "${DAPP_VIEW_HANDLER}"`);
    expect(kotlin).toContain(`PAGE_EVENT = "${DAPP_VIEW_EVENT}"`);
  });

  it("exposes every API method natively", () => {
    for (const method of ["open", "close", "goBack", "reload", "clearData", "postMessage", "setFrame", "setHidden"]) {
      expect(swift).toContain(`CAPPluginMethod(name: "${method}"`);
      expect(kotlin).toMatch(new RegExp(`@PluginMethod\\s+fun ${method}\\(call: PluginCall\\)`));
    }
  });

  it("emits the events the API declares", () => {
    for (const event of ["message", "navigation", "loadError"]) {
      expect(swift).toContain(`notifyListeners("${event}"`);
      expect(kotlin).toContain(`notifyListeners("${event}"`);
    }
  });
});
