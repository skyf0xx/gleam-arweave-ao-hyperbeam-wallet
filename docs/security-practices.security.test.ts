import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const practices = readFileSync(join(import.meta.dirname, "SECURITY_PRACTICES.md"), "utf8");

type Manifest = { name: string; dependencies?: Record<string, string> };

const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));

function workspaceManifests(): Map<string, Manifest> {
  const dirs = ["apps", "packages", "apps/mobile/plugins"].flatMap((parent) =>
    readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name)),
  );
  const manifests = new Map<string, Manifest>();
  for (const dir of dirs) {
    try {
      const manifest = readManifest(dir);
      manifests.set(manifest.name, manifest);
    } catch {
      // A folder without a package.json is not a workspace package.
    }
  }
  return manifests;
}

/** The npm packages the two shells ship, following workspace links. */
function shippedDependencies(): string[] {
  const manifests = workspaceManifests();
  const shipped = new Set<string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const [dep, version] of Object.entries(manifests.get(name)?.dependencies ?? {})) {
      if (version.startsWith("workspace:")) visit(dep);
      else shipped.add(dep);
    }
  };
  visit("@gleam/extension");
  visit("@gleam/mobile");
  return [...shipped].sort();
}

/** Names in the first column of the third-party table; `@scope/*` covers the scope. */
function listedPackages(): string[] {
  const table = practices.split("Third-party code in the shipped wallet:")[1]?.split("\n## ")[0] ?? "";
  return table
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .flatMap((line) => [...(line.split("|")[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]!));
}

const isListed = (dep: string, listed: string[]) =>
  listed.some((entry) => (entry.endsWith("/*") ? dep.startsWith(entry.slice(0, -1)) : entry === dep));

describe("docs/SECURITY_PRACTICES.md", () => {
  const listed = listedPackages();

  it("finds the third-party table", () => {
    expect(listed.length).toBeGreaterThan(0);
  });

  // A reviewer reads this table to learn what third-party code ships, so a
  // new dependency needs a row saying what it is for.
  it.each(shippedDependencies())("lists shipped dependency %s", (dep) => {
    expect(isListed(dep, listed), `add ${dep} to the third-party table with what it is used for`).toBe(true);
  });
});
