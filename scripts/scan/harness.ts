import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Deps, GitRunner } from "./shared.ts";

export const COMMIT = "c".repeat(40);
export const CHALLENGE_ID = "Q".repeat(22);
export const SOURCE = readFileSync(new URL("../../packages/core/src/scan/fixtures/sample.ts.txt", import.meta.url), "utf8");
export const NOW = Date.parse("2026-10-16T00:00:00.000Z");

export const FUNCTIONS = [
  { file: "pkg/a.ts", symbol: "unlockVault" },
  { file: "pkg/b.ts", symbol: "isAllowedOrigin" },
  { file: "pkg/c.ts", symbol: "KeySession.get" },
];
export const LINES = [8, 21, 36];

export const CHALLENGE = {
  challenge: CHALLENGE_ID,
  release: "1.4.0",
  commit: COMMIT,
  functions: FUNCTIONS,
  expiresAt: "2026-10-17T00:00:00.000Z",
};

export function fakeGit(state: { head?: string; tags?: string[]; files?: Record<string, string> } = {}): GitRunner {
  const { head = COMMIT, tags = ["v1.4.0"], files = { "pkg/a.ts": SOURCE, "pkg/b.ts": SOURCE, "pkg/c.ts": SOURCE } } = state;
  return async (args) => {
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "tag") return tags.join("\n");
    if (args[0] === "show") {
      const [commit, ...file] = args[1]!.split(":");
      const text = commit === COMMIT || commit === head ? files[file.join(":")] : undefined;
      if (text === undefined) throw new Error("fatal: path does not exist");
      return text;
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    fetchImpl: (async () => json(CHALLENGE)) as typeof fetch,
    git: fakeGit(),
    root: mkdtempSync(join(tmpdir(), "gleam-scan-")),
    now: () => NOW,
    apiUrl: "https://api.test",
    siteUrl: "https://site.test/",
    ...overrides,
  };
}

export function readJsonFile(deps: Deps, file: string): unknown {
  return JSON.parse(readFileSync(join(deps.root, file), "utf8"));
}

export function exists(deps: Deps, file: string): boolean {
  return existsSync(join(deps.root, file));
}

export function goodAttestation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    challenge: CHALLENGE_ID,
    model: "claude-opus-5-5",
    answers: FUNCTIONS.map((fn, i) => ({ ...fn, line: LINES[i], check: "Rejects bad input before it is used." })),
    result: "pass",
    report: "Read the three functions and the surface; filed nothing.",
    ...overrides,
  };
}
