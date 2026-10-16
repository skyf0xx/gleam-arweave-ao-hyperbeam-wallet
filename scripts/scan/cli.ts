import { execFile } from "node:child_process";
import { POINTS_API_URL } from "../../packages/core/src/models/network.ts";
import { SITE_URL } from "../../apps/extension/src/site-pages.ts";
import { runFinish } from "./finish.ts";
import { runStart } from "./start.ts";
import type { Deps, Outcome } from "./shared.ts";

const USAGE = "Usage: pnpm scan start | pnpm scan finish [--json]";

export function render(outcome: Outcome, color: boolean): string {
  const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const out = outcome.issues.map((issue) => `${paint(31, "✗")} ${issue.path}: ${issue.message}`);
  if (outcome.ok) out.push(...outcome.lines.map((line, i) => (i === 0 ? `${paint(32, "✓")} ${line}` : line)));
  else out.push(...outcome.lines);
  return out.join("\n");
}

export function renderJson(outcome: Outcome): string {
  const { ok, command, issues, json } = outcome;
  return JSON.stringify({ ok, command, ...(issues.length > 0 ? { issues } : {}), ...json });
}

export async function main(argv: string[], deps: Deps, io: { out: (text: string) => void; tty: boolean }): Promise<number> {
  const json = argv.includes("--json");
  const [command] = argv.filter((arg) => !arg.startsWith("--"));
  let outcome: Outcome;
  if (command !== "start" && command !== "finish") {
    outcome = {
      ok: false,
      command: "finish",
      lines: [],
      issues: [{ path: "usage", message: USAGE }],
      json: {},
    };
  } else {
    try {
      outcome = await (command === "start" ? runStart(deps) : runFinish(deps));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      outcome = { ok: false, command, lines: [], issues: [{ path: "scan", message: `Unexpected error (${reason}); run the command again, and if it repeats tell the user.` }], json: {} };
    }
  }
  io.out(json ? renderJson(outcome) : render(outcome, io.tty && !process.env.NO_COLOR));
  return outcome.ok ? 0 : 1;
}

function runGit(cwd: string) {
  return (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) =>
        error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
      );
    });
}

const entry = process.argv[1] ?? "";
if (/scripts[\\/]scan[\\/]cli\.ts$/.test(entry)) {
  const root = process.cwd();
  const deps: Deps = {
    fetchImpl: fetch,
    git: runGit(root),
    root,
    now: () => Date.now(),
    apiUrl: process.env.GLEAM_POINTS_API || POINTS_API_URL,
    siteUrl: process.env.GLEAM_SITE_URL || SITE_URL,
  };
  process.exitCode = await main(process.argv.slice(2), deps, {
    out: (text) => console.log(text),
    tty: Boolean(process.stdout.isTTY),
  });
}
