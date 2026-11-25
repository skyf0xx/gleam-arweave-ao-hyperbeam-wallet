import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isScanAreaId, type ChallengeFunction, type ScanAreaId } from "../../packages/core/src/scan/index.ts";

export const SCAN_DIR = ".gleam-scan";
export const ROUNDS_DIR = `${SCAN_DIR}/rounds`;
/** The area id of the round being worked on; commands without `--area` act on it. */
export const CURRENT_FILE = `${SCAN_DIR}/current`;

/**
 * How many sign requests in a row the user has left unanswered. The agent
 * adds 1 per unanswered request (security/scan/SKILL.md § If the user doesn't
 * sign); `next` deletes it once the server has a signature. On disk, so a new
 * session keeps the count.
 */
export const DECLINES_FILE = `${SCAN_DIR}/declines`;

/** Heads every closing message, which the agent shows the user as the last thing in its turn. */
export const CLOSING_HEADER = "Show the user exactly this, as the last thing you write:";

/** The files of one round, all under `.gleam-scan/rounds/<area>/`. */
export function roundPaths(area: ScanAreaId) {
  const dir = `${ROUNDS_DIR}/${area}`;
  return {
    dir,
    challenge: `${dir}/challenge.json`,
    attestation: `${dir}/attestation.json`,
    /** The area's files, one per line, so the skill's shell commands can take them as pathspecs. */
    areaFiles: `${dir}/area-files.txt`,
    /** Epoch milliseconds of the round's `pnpm scan start`, so `finish` can report the elapsed time. */
    startedAt: `${dir}/started-at`,
    /** Written by `finish` when the round passes, and removed when a later check of it fails. */
    finished: `${dir}/finished.json`,
    /** Written by `next` once the server has the round's signature. */
    signed: `${dir}/signed.json`,
    /** One line per report the agent filed: the draft's file name, then its link. */
    filed: `${dir}/filed.txt`,
  };
}

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
  /** The server's code, when the problem came from the points API. */
  code?: string;
}

export interface ChallengeResponse {
  challenge: string;
  release: string;
  commit: string;
  /** The area the functions were drawn from; the scan reviews that area's files first. */
  area: ScanAreaId;
  functions: ChallengeFunction[];
  expiresAt: string;
}

export interface Outcome {
  ok: boolean;
  command: "start" | "finish" | "file" | "next";
  /** Human lines printed after the issues (or alone on success). */
  lines: string[];
  issues: Problem[];
  json: Record<string, unknown>;
}

export function fail(command: Outcome["command"], issues: Problem[], lines: string[] = [], json: Record<string, unknown> = {}): Outcome {
  return { ok: false, command, lines, issues, json };
}

/** A whole number of atomic units, as the API sends amounts. */
export const ATOMIC = /^\d{1,40}$/;

/** The problem for an API answer that isn't the shape this checkout expects; `what` reads after "sent". */
export function shapeProblem(path: string, what: string, rerun: string): Problem {
  return {
    path,
    message: `The points API sent ${what} in an unexpected shape; update this checkout (\`git fetch --tags\`) and run \`${rerun}\` again.`,
  };
}

export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The lines that end a command's output: the header, then the message the agent's turn ends with. */
export function closingLines(message: string[]): string[] {
  return ["", CLOSING_HEADER, "", ...message];
}

export function closingJson(message: string[]): { closingHeader: string; userMessage: string } {
  return { closingHeader: CLOSING_HEADER, userMessage: message.join("\n") };
}

export async function readText(deps: Deps, file: string): Promise<string | undefined> {
  try {
    return await readFile(join(deps.root, file), "utf8");
  } catch {
    return undefined;
  }
}

export async function writeText(deps: Deps, file: string, text: string): Promise<void> {
  await mkdir(join(deps.root, dirname(file)), { recursive: true });
  await writeFile(join(deps.root, file), text);
}

export async function writeJson(deps: Deps, file: string, value: unknown): Promise<void> {
  await writeText(deps, file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson(deps: Deps, file: string): Promise<unknown> {
  const text = await readText(deps, file);
  return text === undefined ? undefined : parseJsonOrUndefined(text);
}

export async function readDeclines(deps: Deps): Promise<number> {
  const n = Number((await readText(deps, DECLINES_FILE))?.trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** The line `file` and `next` print above a sign request, so the agent knows which ask this is. */
export const declinesLine = (n: number) => `Unanswered sign requests so far: ${n} (${DECLINES_FILE}).`;

export async function readCurrent(deps: Deps): Promise<ScanAreaId | undefined> {
  const text = (await readText(deps, CURRENT_FILE))?.trim();
  return isScanAreaId(text) ? text : undefined;
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
    isScanAreaId(v.area) &&
    Array.isArray(v.functions) &&
    v.functions.every((fn) => {
      const f = fn as Record<string, unknown> | null;
      return f !== null && typeof f === "object" && typeof f.file === "string" && typeof f.symbol === "string";
    })
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function jsonParseProblem(file: string, text: string, error: unknown): Problem {
  const detail = errorMessage(error);
  const position = /position (\d+)/.exec(detail);
  let where = "";
  if (position) {
    const before = text.slice(0, Number(position[1]));
    const line = before.split("\n").length;
    where = ` at line ${line}, column ${before.length - before.lastIndexOf("\n")}`;
  }
  return { path: file, message: `${file} isn't valid JSON${where}; fix the syntax (${detail.split("\n")[0]}).` };
}

/** "42s", "7m 05s" or "1h 02m 03s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

export const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
