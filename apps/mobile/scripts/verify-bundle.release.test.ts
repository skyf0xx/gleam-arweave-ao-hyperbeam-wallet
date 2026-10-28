// @vitest-environment node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashDirectory } from "./bundle-hash.mjs";

const TAG = "v1.2.3";
const files = { "index.html": "<html>", "assets/app.js": "console.log(1)" };

let root: string;
let script: string;
let dist: string;
let native: string;
let distHash: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verify-bundle-"));
  // The script reads ../dist next to itself, so it runs from a copy in a
  // fixture tree and never touches the real build output.
  const scripts = join(root, "apps/mobile/scripts");
  mkdirSync(scripts, { recursive: true });
  for (const name of ["verify-bundle.mjs", "bundle-hash.mjs"]) copyFileSync(join(__dirname, name), join(scripts, name));
  script = join(scripts, "verify-bundle.mjs");
  dist = join(root, "apps/mobile/dist");
  native = join(root, "public");
  for (const [name, body] of Object.entries(files)) {
    write(dist, name, body);
    write(native, name, body);
  }
  distHash = hashDirectory(dist);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(dir: string, name: string, body: string) {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), body);
}

function manifest(body: Record<string, unknown>) {
  write(join(root, "releases", TAG), "release-manifest.json", JSON.stringify(body));
}

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", GLEAM_RELEASE_BASE_URL: `file://${join(root, "releases")}`, ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("verify-bundle", () => {
  it("passes when dist and native match the manifest", () => {
    manifest({ tag: TAG, mobileBundleSha256: distHash });
    const r = run([TAG, native]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("PASS");
  });

  it("fails on a hash mismatch", () => {
    manifest({ tag: TAG, mobileBundleSha256: "0".repeat(64) });
    const r = run([TAG, native]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("differs from the manifest");
  });

  it("fails when the manifest has no mobileBundleSha256", () => {
    manifest({ tag: TAG });
    const r = run([TAG, native]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no mobileBundleSha256");
  });

  it("fails when the manifest is for another tag", () => {
    manifest({ tag: "v9.9.9", mobileBundleSha256: distHash });
    const r = run([TAG, native]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("not v1.2.3");
  });

  it("rejects a malformed tag", () => {
    const r = run(["1.2.3", native]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("usage");
  });

  it("with the bypass warns, skips the manifest, still compares native with dist", () => {
    manifest({ tag: TAG });
    const ok = run([TAG, native], { GLEAM_ALLOW_UNVERIFIED_BUNDLE: "1" });
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("WARNING");
    write(native, "index.html", "tampered");
    const bad = run([TAG, native], { GLEAM_ALLOW_UNVERIFIED_BUNDLE: "1" });
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("differs from dist");
  });

  it("ignores cordova.js and cordova_plugins.js at the top level only", () => {
    manifest({ tag: TAG, mobileBundleSha256: distHash });
    write(native, "cordova.js", "// added by cap sync");
    write(native, "cordova_plugins.js", "// added by cap sync");
    expect(run([TAG, native]).code).toBe(0);
    write(native, "assets/cordova.js", "// nested files are part of the bundle");
    const r = run([TAG, native]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("differs from dist");
  });
});
