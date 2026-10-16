import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChallengeFunction } from "../../packages/core/src/scan/index.ts";

export const SCAN_DIR = ".gleam-scan";
export const CHALLENGE_FILE = `${SCAN_DIR}/challenge.json`;
export const ATTESTATION_FILE = `${SCAN_DIR}/attestation.json`;

/** Runs `git <args>` in the checkout and returns stdout; rejects when git exits non-zero. */
export type GitRunner = (args: string[]) => Promise<string>;

export interface Deps {
  fetchImpl: typeof fetch;
  git: GitRunner;
  /** The checkout: `.gleam-scan/` is read and written under it. */
  root: string;
  now: () => number;
  apiUrl: string;
  siteUrl: string;
}

/** A line printed as `✗ <path>: <message>`. */
export interface Problem {
  path: string;
  message: string;
}

export interface ChallengeResponse {
  challenge: string;
  release: string;
  commit: string;
  functions: ChallengeFunction[];
  expiresAt: string;
}

export interface Outcome {
  ok: boolean;
  command: "start" | "finish";
  /** Human lines printed after the issues (or alone on success). */
  lines: string[];
  issues: Problem[];
  json: Record<string, unknown>;
}

export function fail(command: Outcome["command"], issues: Problem[]): Outcome {
  return { ok: false, command, lines: [], issues, json: {} };
}

export async function readText(deps: Deps, file: string): Promise<string | undefined> {
  try {
    return await readFile(join(deps.root, file), "utf8");
  } catch {
    return undefined;
  }
}

export async function writeJson(deps: Deps, file: string, value: unknown): Promise<void> {
  await mkdir(join(deps.root, SCAN_DIR), { recursive: true });
  await writeFile(join(deps.root, file), `${JSON.stringify(value, null, 2)}\n`);
}

export async function gitOrUndefined(deps: Deps, args: string[]): Promise<string | undefined> {
  try {
    return (await deps.git(args)).trim();
  } catch {
    return undefined;
  }
}

/** The file's text at `commit`, never the working tree: that is what the server checks. */
export async function showAtCommit(deps: Deps, commit: string, file: string): Promise<string | undefined> {
  try {
    return await deps.git(["show", `${commit}:${file}`]);
  } catch {
    return undefined;
  }
}

export function isChallengeResponse(value: unknown): value is ChallengeResponse {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.challenge === "string" &&
    typeof v.release === "string" &&
    typeof v.commit === "string" &&
    typeof v.expiresAt === "string" &&
    Array.isArray(v.functions) &&
    v.functions.every((fn) => {
      const f = fn as Record<string, unknown> | null;
      return f !== null && typeof f === "object" && typeof f.file === "string" && typeof f.symbol === "string";
    })
  );
}

export function jsonParseProblem(file: string, text: string, error: unknown): Problem {
  const detail = error instanceof Error ? error.message : String(error);
  const position = /position (\d+)/.exec(detail);
  let where = "";
  if (position) {
    const before = text.slice(0, Number(position[1]));
    const line = before.split("\n").length;
    where = ` at line ${line}, column ${before.length - before.lastIndexOf("\n")}`;
  }
  return { path: file, message: `${file} isn't valid JSON${where}; fix the syntax (${detail.split("\n")[0]}).` };
}
