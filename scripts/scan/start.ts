import { findFunction, isJsxPath } from "../../packages/core/src/scan/index.ts";
import { callApi } from "./api.ts";
import {
  ATTESTATION_FILE,
  CHALLENGE_FILE,
  SCAN_DIR,
  STARTED_FILE,
  fail,
  gitOrUndefined,
  isChallengeResponse,
  readText,
  showAtCommit,
  writeJson,
  type Deps,
  type Outcome,
  type Problem,
} from "./shared.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function runStart(deps: Deps): Promise<Outcome> {
  const fetched = await callApi(deps, "/scan/challenge", undefined, "pnpm scan start");
  if (!fetched.ok) return fail("start", fetched.issues);
  if (!isChallengeResponse(fetched.body) || fetched.body.functions.length === 0) {
    return fail("start", [
      { path: "challenge", message: "The points API sent a challenge in an unexpected shape; update this checkout (`git fetch --tags`) and run `pnpm scan start` again." },
    ]);
  }
  const challenge = fetched.body;

  const head = await gitOrUndefined(deps, ["rev-parse", "HEAD"]);
  if (head === undefined) {
    return fail("start", [{ path: "git", message: "This isn't a git checkout of Gleam; run `pnpm scan start` from inside a git checkout of the latest Gleam release tag." }]);
  }
  if (head !== challenge.commit) {
    return fail("start", [
      {
        path: "git",
        message: `HEAD is ${head.slice(0, 7)} but the latest release is v${challenge.release} (${challenge.commit.slice(0, 7)}); run \`git fetch --tags && git checkout v${challenge.release} && pnpm install --frozen-lockfile\`, then \`pnpm scan start\` again.`,
      },
    ]);
  }

  const spans: { file: string; symbol: string; startLine: number; endLine: number }[] = [];
  const problems: Problem[] = [];
  for (const fn of challenge.functions) {
    const text = await showAtCommit(deps, challenge.commit, fn.file);
    const span = text === undefined ? undefined : findFunction(text, fn.symbol, { jsx: isJsxPath(fn.file) });
    if (!span) {
      problems.push({
        path: fn.file,
        message: `\`${fn.symbol}\` isn't in ${fn.file} at ${challenge.commit.slice(0, 7)}; run \`git fetch --tags\` and \`pnpm scan start\` again, and if it persists tell the user the challenge is broken.`,
      });
    } else spans.push({ ...fn, startLine: span.startLine, endLine: span.endLine });
  }
  if (problems.length > 0) return fail("start", problems);

  const notes: string[] = [];
  await writeJson(deps, CHALLENGE_FILE, challenge);
  await writeFile(join(deps.root, STARTED_FILE), `${deps.now()}\n`);
  const existingText = await readText(deps, ATTESTATION_FILE);
  let existing: unknown;
  let keep = false;
  if (existingText !== undefined) {
    try {
      existing = JSON.parse(existingText);
    } catch {
      existing = undefined;
    }
    const old = (existing as { challenge?: unknown } | null | undefined)?.challenge;
    keep = old === challenge.challenge;
    if (!keep) {
      const label = typeof old === "string" && /^[A-Za-z0-9_-]+$/.test(old) ? old : "unreadable";
      const backup = `${SCAN_DIR}/attestation.${label}.json`;
      await writeFile(join(deps.root, backup), existingText);
      notes.push(`Backed up the previous ${ATTESTATION_FILE} to ${backup}.`);
    }
  }
  if (!keep) {
    await writeJson(deps, ATTESTATION_FILE, {
      challenge: challenge.challenge,
      model: "",
      answers: spans.map(({ file, symbol }) => ({ file, symbol, line: 0, check: "" })),
      result: "pass",
      report: "",
    });
  }

  const short = challenge.commit.slice(0, 7);
  const lines = [
    `Challenge ready for Gleam v${challenge.release} (commit ${short}).`,
    "Answer these functions. Lines are checked against the committed file (`git show <commit>:<file>`), not your working tree.",
    ...spans.map((s, i) => `  ${i + 1}. ${s.file}  ${s.symbol}  lines ${s.startLine}-${s.endLine}`),
    `Expires: ${challenge.expiresAt}`,
    ...notes,
    keep ? `Kept your ${ATTESTATION_FILE}.` : `Wrote ${CHALLENGE_FILE} and a starter ${ATTESTATION_FILE}.`,
    "Next:",
    "  1. Read security/scan/SKILL.md and scan the release.",
    `  2. Edit ${ATTESTATION_FILE}: per answer set line (a line in the function body that makes a security check) and check (one sentence on what it prevents); set model, result ("pass" or "scanned") and report.`,
    "  3. Run `pnpm scan finish`.",
  ];
  return { ok: true, command: "start", lines, issues: [], json: { challenge: { ...challenge, functions: spans } } };
}
