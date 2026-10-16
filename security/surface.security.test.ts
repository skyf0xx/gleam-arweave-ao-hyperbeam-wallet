import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSurface } from "./surface.mjs";

const ROOT = resolve(__dirname, "..");

function contentLines(file: string): string[] {
  return readFileSync(resolve(ROOT, file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

const surface = parseSurface(readFileSync(resolve(ROOT, "security/surface.txt"), "utf8"));

const codeowners = contentLines(".github/CODEOWNERS").map((line) => line.split(/\s+/)[0]!.replace(/^\//, ""));

describe("security/surface.txt", () => {
  it("has one tier from 1 to 5 and one path per line", () => {
    for (const entry of surface) {
      expect(entry.tier, entry.line).toMatch(/^[1-5]$/);
      expect(entry.path, entry.line).not.toBe("");
      expect(entry.rest, entry.line).toEqual([]);
    }
  });

  it("lists every path once", () => {
    const paths = surface.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  // A renamed or moved file would otherwise drop out of the release gate silently.
  it("names only paths that exist, with a trailing / exactly on directories", () => {
    for (const { path } of surface) {
      const full = resolve(ROOT, path);
      expect(existsSync(full), `${path} does not exist`).toBe(true);
      expect(statSync(full).isDirectory(), `${path}: trailing / must match being a directory`).toBe(path.endsWith("/"));
    }
  });

  it("matches .github/CODEOWNERS", () => {
    expect([...codeowners].sort()).toEqual(surface.map((entry) => entry.path).sort());
  });
});
