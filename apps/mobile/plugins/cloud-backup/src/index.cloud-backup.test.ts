import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const registerPlugin = vi.hoisted(() => vi.fn((name: string) => ({ name })));
vi.mock("@capacitor/core", () => ({ registerPlugin }));

import { CLOUD_ERROR, GoogleDriveAuth, ICloudFile } from "./index";

const swift = readFileSync(resolve(__dirname, "../ios/Sources/ICloudFilePlugin/ICloudFilePlugin.swift"), "utf8");
const kotlin = readFileSync(resolve(__dirname, "../android/src/main/java/app/gleamwallet/cloudbackup/GoogleDriveAuthPlugin.kt"), "utf8");
const entitlements = readFileSync(resolve(__dirname, "../../../ios/App/App/App.entitlements"), "utf8");

// The TypeScript API and the native code meet only through these strings,
// so a rename on either side would fail silently on a device.
describe("cloud backup plugins", () => {
  it("register under the native plugins' names", () => {
    expect(ICloudFile).toEqual({ name: "ICloudFile" });
    expect(swift).toContain('jsName = "ICloudFile"');
    expect(GoogleDriveAuth).toEqual({ name: "GoogleDriveAuth" });
    expect(kotlin).toContain('@CapacitorPlugin(name = "GoogleDriveAuth")');
  });

  it("expose every API method natively", () => {
    for (const method of ["available", "read", "write", "remove"]) expect(swift).toContain(`CAPPluginMethod(name: "${method}"`);
    for (const method of ["authorize", "clearToken"]) expect(kotlin).toMatch(new RegExp(`@PluginMethod\\s+fun ${method}\\(`));
  });

  it("reject with the codes the adapters read", () => {
    expect(swift).toContain(`"${CLOUD_ERROR.notSignedIn}"`);
    expect(swift).toContain(`"${CLOUD_ERROR.unreachable}"`);
    expect(kotlin).toContain(`UNREACHABLE = "${CLOUD_ERROR.unreachable}"`);
  });

  it("asks Google for the app folder only", () => {
    expect(kotlin.match(/https:\/\/www\.googleapis\.com\/auth\/[\w.]+/g)).toEqual(["https://www.googleapis.com/auth/drive.appdata"]);
  });

  it("uses the container the app is entitled to, through CloudKit", () => {
    expect(swift).toContain('containerIdentifier = "iCloud.app.gleamwallet"');
    expect(entitlements).toMatch(/icloud-container-identifiers<\/key>\s*<array>\s*<string>iCloud\.app\.gleamwallet<\/string>/);
    expect(entitlements).toMatch(/icloud-services<\/key>\s*<array>\s*<string>CloudKit<\/string>/);
  });
});
