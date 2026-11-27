import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const dockerfiles = execFileSync("git", ["ls-files", "*Dockerfile"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

describe("every Dockerfile", () => {
  const dependabot = readFileSync(join(ROOT, ".github/dependabot.yml"), "utf8");
  const block = /package-ecosystem: docker\n\s+directories:\n((?:\s+- .+\n)+)/.exec(dependabot);
  const watched = [...(block?.[1] ?? "").matchAll(/- "?([^"\n]+)"?/g)].map((match) => match[1]!);

  it("is found", () => {
    expect(dockerfiles.length).toBeGreaterThan(0);
  });

  // Scorecard's Pinned-Dependencies check: a tag can be moved to another
  // image, a digest cannot.
  it.each(dockerfiles)("%s pins every base image by digest", (file) => {
    const froms = readFileSync(join(ROOT, file), "utf8")
      .split("\n")
      .filter((line) => /^FROM\s/i.test(line));
    expect(froms.length).toBeGreaterThan(0);
    for (const from of froms) expect(from).toMatch(/^FROM\s+\S+@sha256:[0-9a-f]{64}(\s|$)/i);
  });

  // pnpm comes from corepack and the root packageManager field; a global
  // npm install is an unpinned package fetch.
  it.each(dockerfiles)("%s installs nothing with npm install", (file) => {
    expect(readFileSync(join(ROOT, file), "utf8")).not.toMatch(/\bnpm\s+(install|i)\b/);
  });

  it.each(dockerfiles)("%s is in Dependabot's docker directories", (file) => {
    expect(watched).toContain(`/${dirname(file)}`);
  });
});
