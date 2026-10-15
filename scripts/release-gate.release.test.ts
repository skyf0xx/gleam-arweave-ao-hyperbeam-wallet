// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSurface, surfacePaths } from "../security/surface.mjs";
import { blockingFindings, parseFindings, parseFrontmatter, parseList, runGate } from "./release-gate.mjs";

const SHA = "a".repeat(40);

function audit({
  version = "1.2.3",
  commit = SHA,
  findings = "| F-1 | low | Minor thing. | fixed |",
}: { version?: string; commit?: string; findings?: string } = {}): string {
  return [
    "---",
    `version: ${version}`,
    `commit: ${commit}`,
    "previous: none",
    "date: 2026-10-16",
    'reviewers: ["/security-review", "Will (manual)"]',
    "---",
    "",
    "## Scope",
    "",
    "Everything.",
    "",
    "## Findings",
    "",
    "| id | severity | summary | status |",
    "| --- | --- | --- | --- |",
    findings,
    "",
    "## Notes",
    "",
    "| not | a | finding | row |",
    "",
  ].join("\n");
}

describe("parseSurface / surfacePaths", () => {
  const text = "# comment\n\n1 packages/core/src/vault/\n5   lefthook.yml\n";

  it("skips comments and blank lines", () => {
    expect(parseSurface(text)).toEqual([
      { line: "1 packages/core/src/vault/", tier: "1", path: "packages/core/src/vault/", rest: [] },
      { line: "5   lefthook.yml", tier: "5", path: "lefthook.yml", rest: [] },
    ]);
  });

  it("returns the paths of a valid list", () => {
    expect(surfacePaths(text)).toEqual(["packages/core/src/vault/", "lefthook.yml"]);
  });

  it.each(["6 foo.ts", "1", "x foo.ts", "1 foo.ts extra"])("rejects %j", (line) => {
    expect(() => surfacePaths(line)).toThrow(/malformed surface line/);
  });
});

describe("parseList", () => {
  it("splits on commas outside quotes", () => {
    expect(parseList('["/security-review", "Will, manual", reviewer agent]')).toEqual([
      "/security-review",
      "Will, manual",
      "reviewer agent",
    ]);
  });

  it("reads an empty list", () => {
    expect(parseList("[]")).toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  it("reads every field and returns the body", () => {
    const { meta, body } = parseFrontmatter(audit());
    expect(meta).toEqual({
      version: "1.2.3",
      commit: SHA,
      previous: "none",
      date: "2026-10-16",
      reviewers: ["/security-review", "Will (manual)"],
    });
    expect(body).toContain("## Findings");
  });

  it("rejects a file without frontmatter", () => {
    expect(() => parseFrontmatter("# Audit\n")).toThrow(/no frontmatter/);
  });

  it("rejects unclosed frontmatter", () => {
    expect(() => parseFrontmatter("---\nversion: 1.0.0\n")).toThrow(/not closed/);
  });

  it("names a missing field", () => {
    expect(() => parseFrontmatter(audit().replace(/^commit:.*\n/m, ""))).toThrow(/missing "commit"/);
  });
});

describe("parseFindings", () => {
  it("reads rows by header name and stops at the next section", () => {
    const body = parseFrontmatter(audit({ findings: "| F-1 | High | Leak. | Open |\n| F-2 | info | Note. | accepted |" })).body;
    expect(parseFindings(body)).toEqual([
      { id: "F-1", severity: "high", summary: "Leak.", status: "open" },
      { id: "F-2", severity: "info", summary: "Note.", status: "accepted" },
    ]);
  });

  it("accepts columns in any order", () => {
    const body = "## Findings\n\n| status | id | summary | severity |\n|-|-|-|-|\n| fixed | F-1 | x | medium |\n";
    expect(parseFindings(body)).toEqual([{ id: "F-1", severity: "medium", summary: "x", status: "fixed" }]);
  });

  it("returns no findings for an empty table", () => {
    expect(parseFindings("## Findings\n\nNone.\n")).toEqual([]);
  });

  it("rejects a missing section, column, severity or status", () => {
    expect(() => parseFindings("## Scope\n")).toThrow(/no "## Findings"/);
    expect(() => parseFindings("## Findings\n| id | summary | status |\n|-|-|-|\n")).toThrow(/no "severity" column/);
    expect(() => parseFindings(parseFrontmatter(audit({ findings: "| F-1 | hihg | x | open |" })).body)).toThrow(
      /unknown severity "hihg"/,
    );
    expect(() => parseFindings(parseFrontmatter(audit({ findings: "| F-1 | low | x | done |" })).body)).toThrow(
      /unknown status "done"/,
    );
  });
});

describe("blockingFindings", () => {
  it("blocks only open critical and high findings", () => {
    const findings = [
      { id: "1", severity: "critical", summary: "", status: "open" },
      { id: "2", severity: "high", summary: "", status: "open" },
      { id: "3", severity: "high", summary: "", status: "accepted" },
      { id: "4", severity: "medium", summary: "", status: "open" },
    ];
    expect(blockingFindings(findings).map((f) => f.id)).toEqual(["1", "2"]);
  });
});

describe("runGate against a throwaway repo", () => {
  let repo: string;

  const run = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
      { cwd: repo, encoding: "utf8" },
    ).trim();

  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };

  const commit = (message: string) => {
    run("add", "-A");
    run("commit", "--quiet", "-m", message);
    return run("rev-parse", "HEAD");
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "gleam-release-gate-"));
    run("init", "--quiet", "-b", "master");
    write("apps/extension/package.json", JSON.stringify({ version: "1.2.3" }));
    write("security/surface.txt", "# surface\n1 core/vault/\n5 lock.yaml\n");
    write("core/vault/key.ts", "export const k = 1;\n");
    write("lock.yaml", "a: 1\n");
    write("README.md", "hello\n");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const audited = (options: Parameters<typeof audit>[0] = {}) => {
    const sha = commit("base");
    write("security/audits/v1.2.3.md", audit({ commit: sha, ...options }));
    commit("audit");
    return sha;
  };

  it("passes when the surface is untouched since the audited commit", () => {
    const sha = audited();
    expect(runGate({ cwd: repo })).toEqual({ ok: true, version: "1.2.3", commit: sha });
  });

  it("passes when only a non-surface file changed", () => {
    audited();
    write("README.md", "changed\n");
    commit("docs");
    expect(runGate({ cwd: repo }).ok).toBe(true);
  });

  it("fails and lists the files when a surface file changed", () => {
    audited();
    write("core/vault/key.ts", "export const k = 2;\n");
    write("lock.yaml", "a: 2\n");
    commit("touch surface");
    const result = runGate({ cwd: repo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/2 security-surface file\(s\) changed/);
    expect(result.details).toEqual(["core/vault/key.ts", "lock.yaml"]);
  });

  it("still sees a change to a path dropped from surface.txt after the audit", () => {
    audited();
    write("security/surface.txt", "1 core/vault/\n");
    write("lock.yaml", "a: 2\n");
    commit("drop and change");
    const result = runGate({ cwd: repo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details).toEqual(["lock.yaml", "security/surface.txt"]);
  });

  it("fails when the audit file is missing", () => {
    commit("base");
    expect(runGate({ cwd: repo })).toEqual({
      ok: false,
      reason: "no audit for v1.2.3: security/audits/v1.2.3.md does not exist",
    });
  });

  it("fails when the audit's version doesn't match", () => {
    audited({ version: "1.2.2" });
    const result = runGate({ cwd: repo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/says version 1\.2\.2/);
  });

  it("fails when the commit is not a full sha", () => {
    audited({ commit: "abc123" });
    const result = runGate({ cwd: repo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a full 40-character sha/);
  });

  it("fails when the commit doesn't exist", () => {
    audited({ commit: "b".repeat(40) });
    const result = runGate({ cwd: repo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not exist in this repository/);
  });

  it("fails when the commit isn't an ancestor of HEAD", () => {
    commit("base");
    run("checkout", "--quiet", "-b", "side");
    write("README.md", "side\n");
    const side = commit("side");
    run("checkout", "--quiet", "master");
    write("security/audits/v1.2.3.md", audit({ commit: side }));
    commit("audit");
    const result = runGate({ cwd: repo });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/is not an ancestor of HEAD/);
  });

  it("fails on an open high finding", () => {
    audited({ findings: "| F-1 | high | Key leaks. | open |" });
    const result = runGate({ cwd: repo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/1 open critical\/high finding/);
    expect(result.details).toEqual(["F-1 [high] Key leaks."]);
  });

  it("passes with an open medium finding", () => {
    audited({ findings: "| F-1 | medium | Minor. | open |" });
    expect(runGate({ cwd: repo }).ok).toBe(true);
  });
});
