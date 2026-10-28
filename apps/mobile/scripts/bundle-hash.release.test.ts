// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashDirectory } from "./bundle-hash.mjs";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bundle-hash-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(dir: string, files: Record<string, string>): string {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const files = { "index.html": "<html>", "assets/app.js": "console.log(1)", "assets/a/b.css": "body{}" };

describe("hashDirectory", () => {
  it("is a 64-char hex digest and is stable", () => {
    const dir = write(join(root, "a"), files);
    expect(hashDirectory(dir)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDirectory(dir)).toBe(hashDirectory(dir));
  });

  it("does not depend on the order files were written", () => {
    const a = write(join(root, "a"), files);
    const b = write(join(root, "b"), Object.fromEntries(Object.entries(files).reverse()));
    expect(hashDirectory(b)).toBe(hashDirectory(a));
  });

  it("changes when a byte changes", () => {
    const a = write(join(root, "a"), files);
    const b = write(join(root, "b"), { ...files, "assets/app.js": "console.log(2)" });
    expect(hashDirectory(b)).not.toBe(hashDirectory(a));
  });

  it("changes when a file is renamed, added or removed", () => {
    const a = hashDirectory(write(join(root, "a"), files));
    const renamed = hashDirectory(write(join(root, "b"), { ...files, "assets/app.js": "", "assets/app2.js": "console.log(1)" }));
    const added = hashDirectory(write(join(root, "c"), { ...files, "extra.txt": "x" }));
    const removed = hashDirectory(write(join(root, "d"), { "assets/app.js": files["assets/app.js"], "assets/a/b.css": files["assets/a/b.css"] }));
    expect(new Set([a, renamed, added, removed]).size).toBe(4);
  });

  it("ignores excluded top-level files only", () => {
    const a = write(join(root, "a"), files);
    const b = write(join(root, "b"), { ...files, "cordova.js": "// added by cap sync" });
    expect(hashDirectory(b, { exclude: ["cordova.js"] })).toBe(hashDirectory(a));
    expect(hashDirectory(b)).not.toBe(hashDirectory(a));
  });

  it("matches the known answer for a fixed tree", () => {
    const dir = write(join(root, "kat"), { "index.html": "<html>", "assets/app.js": "console.log(1)" });
    expect(hashDirectory(dir)).toBe("e8f7d8ae95946da3f3972f0677b349115253fe5b0022132499b3e1d1b2e6bd43");
  });

  it("refuses a symlinked file and a symlinked directory", () => {
    const file = write(join(root, "a"), files);
    symlinkSync("/etc/hosts", join(file, "link"));
    expect(() => hashDirectory(file)).toThrow(/symlink/);
    const dir = write(join(root, "b"), files);
    symlinkSync(file, join(dir, "linked-dir"));
    expect(() => hashDirectory(dir)).toThrow(/symlink/);
  });

  it("rejects empty directories", () => {
    mkdirSync(join(root, "empty"));
    expect(() => hashDirectory(join(root, "empty"))).toThrow(/no files/);
  });

  it("the CLI prints the same digest", () => {
    const dir = write(join(root, "a"), files);
    const out = execFileSync("node", [join(__dirname, "bundle-hash.mjs"), dir], { encoding: "utf8" });
    expect(out.trim()).toBe(hashDirectory(dir));
  });
});
