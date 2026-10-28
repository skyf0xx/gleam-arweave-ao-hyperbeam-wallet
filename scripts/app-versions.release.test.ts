// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVersions, readVersions, writeVersions } from "./app-versions.mjs";

const PBX = "apps/mobile/ios/App/App.xcodeproj/project.pbxproj";
const PROPS = "apps/mobile/android/app/version.properties";

const pbxproj = (marketing = ["1.0", "1.0"], build = ["1", "1"]) =>
  [
    "// !$*UTF8*$!",
    "\t\t\tbuildSettings = {",
    `\t\t\t\tCURRENT_PROJECT_VERSION = ${build[0]};`,
    "\t\t\t\tINFOPLIST_FILE = App/Info.plist;",
    `\t\t\t\tMARKETING_VERSION = ${marketing[0]};`,
    "\t\t\t};",
    "\t\t\tbuildSettings = {",
    `\t\t\t\tCURRENT_PROJECT_VERSION = ${build[1]};`,
    `\t\t\t\tMARKETING_VERSION = ${marketing[1]};`,
    "\t\t\t};",
    "",
  ].join("\n");

const props = (extra = "") =>
  ["# Written by scripts/app-versions.mjs.", "versionCode=7", "versionName=1.0", extra, ""].join("\n");

let root: string;
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const get = (rel: string) => readFileSync(join(root, rel), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "app-versions-"));
  put("apps/extension/package.json", `${JSON.stringify({ name: "e", version: "1.31.0" }, null, 2)}\n`);
  put("apps/mobile/package.json", `${JSON.stringify({ name: "m", version: "1.30.0" }, null, 2)}\n`);
  put(PBX, pbxproj());
  put(PROPS, props());
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readVersions", () => {
  it("reads every location", () => {
    expect(readVersions(root)).toEqual({
      extension: "1.31.0",
      mobile: "1.30.0",
      iosMarketing: "1.0",
      iosBuild: 1,
      androidName: "1.0",
      androidCode: 7,
    });
  });

  it("refuses a wrong number of lines", () => {
    put(PBX, `${pbxproj()}\t\t\t\tMARKETING_VERSION = 1.0;\n`);
    expect(() => readVersions(root)).toThrow(/MARKETING_VERSION.*expected 2.*found 3/);
    put(PBX, pbxproj());
    put(PROPS, props("versionCode=8"));
    expect(() => readVersions(root)).toThrow(/versionCode.*expected 1.*found 2/);
  });

  it("refuses a non-integer versionCode", () => {
    put(PROPS, "versionCode=abc\nversionName=1.0\n");
    expect(() => readVersions(root)).toThrow(/versionCode is not an integer/);
  });

  it("refuses pairs that disagree", () => {
    put(PBX, pbxproj(["1.0", "1.1"]));
    expect(() => readVersions(root)).toThrow(/MARKETING_VERSION.*disagree/);
    put(PBX, pbxproj(["1.0", "1.0"], ["1", "2"]));
    expect(() => readVersions(root)).toThrow(/CURRENT_PROJECT_VERSION.*disagree/);
  });
});

describe("writeVersions", () => {
  it("sets versions and increments both build numbers", () => {
    const changed = writeVersions(root, "1.32.0");
    expect(changed.sort()).toEqual(
      ["apps/extension/package.json", "apps/mobile/package.json", PBX, PROPS].sort(),
    );
    expect(readVersions(root)).toEqual({
      extension: "1.32.0",
      mobile: "1.32.0",
      iosMarketing: "1.32.0",
      iosBuild: 2,
      androidName: "1.32.0",
      androidCode: 8,
    });
  });

  it("changes only the version lines", () => {
    writeVersions(root, "1.32.0");
    expect(get(PBX)).toBe(pbxproj(["1.32.0", "1.32.0"], ["2", "2"]));
    expect(get(PROPS)).toBe(props().replace("versionCode=7", "versionCode=8").replace("versionName=1.0", "versionName=1.32.0"));
    expect(get("apps/mobile/package.json")).toBe(`${JSON.stringify({ name: "m", version: "1.32.0" }, null, 2)}\n`);
  });

  it("touches nothing when a file fails validation", () => {
    put(PROPS, "versionName=1.0\n");
    expect(() => writeVersions(root, "1.32.0")).toThrow();
    expect(readVersions.bind(null, root)).toThrow();
    expect(get("apps/extension/package.json")).toContain("1.31.0");
  });
});

describe("checkVersions", () => {
  it("passes when everything matches", () => {
    writeVersions(root, "1.32.0");
    expect(() => checkVersions(root, "1.32.0")).not.toThrow();
  });

  it("names each location that differs", () => {
    expect(() => checkVersions(root, "1.31.0")).toThrow(/mobile is 1\.30\.0.*iosMarketing is 1\.0.*androidName is 1\.0/);
  });
});
