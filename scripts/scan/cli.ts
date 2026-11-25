import { execFile } from "node:child_process";
import { POINTS_API_URL } from "../../packages/core/src/models/network.ts";
import { SITE_URL } from "../../packages/core/src/models/site-origin.ts";
import { runFile } from "./file.ts";
import { runFinish } from "./finish.ts";
import { runNext } from "./next.ts";
import { runStart } from "./start.ts";
import { errorMessage, fail, type Deps, type Outcome } from "./shared.ts";

const USAGE = "Usage: pnpm scan start [--area <id>] | pnpm scan finish [--area <id>] | pnpm scan file | pnpm scan next [--json]";
const COMMANDS = ["start", "finish", "file", "next"] as const;

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
  let area: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--area") area = argv[++i] ?? "";
    else if (arg.startsWith("--area=")) area = arg.slice("--area=".length);
    else if (!arg.startsWith("--")) positional.push(arg);
  }
  const command = COMMANDS.find((c) => c === positional[0]);
  let outcome: Outcome;
  if (command === undefined) {
    outcome = fail("finish", [{ path: "usage", message: USAGE }]);
  } else if (area !== undefined && (command === "file" || command === "next")) {
    outcome = fail(command, [{ path: "area", message: `\`pnpm scan ${command}\` acts on every waiting round; run it without --area.` }]);
  } else {
    try {
      outcome = await (command === "start"
        ? runStart(deps, { area })
        : command === "finish"
          ? runFinish(deps, { area })
          : command === "file"
            ? runFile(deps)
            : runNext(deps));
    } catch (error) {
      const reason = errorMessage(error);
      outcome = fail(command, [{ path: "scan", message: `Unexpected error (${reason}); run the command again, and if it repeats tell the user.` }]);
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
