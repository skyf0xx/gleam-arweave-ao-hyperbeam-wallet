import {
  SCAN_AREAS,
  findFunction,
  isJsxPath,
  isScanAreaId,
  parseSurfaceText,
  scanArea,
  surfaceFileTiers,
  type ScanAreaId,
  type SurfaceEntry,
  type SurfaceTier,
} from "../../packages/core/src/scan/index.ts";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { callApi } from "./api.ts";
import { everyAreaHere, fetchAreas, freeAreas, listRounds, sumReports, type Round } from "./rounds.ts";
import {
  CURRENT_FILE,
  SCAN_DIR,
  closingJson,
  closingLines,
  fail,
  gitOrUndefined,
  isChallengeResponse,
  parseJsonOrUndefined,
  readText,
  roundPaths,
  shapeProblem,
  showAtCommit,
  writeJson,
  writeText,
  type Deps,
  type Outcome,
  type Problem,
} from "./shared.ts";

const AREA_IDS = SCAN_AREAS.map((area) => area.id).join(", ");

/**
 * The files of one area: the scannable files `surfaceFileTiers` puts in the
 * tier, plus the config, CI and lockfile entries the challenge never draws
 * from but a build-area review still has to read. Tests are left out.
 */
export function areaFiles(entries: readonly SurfaceEntry[], paths: readonly string[], tier: SurfaceTier): string[] {
  const scannable = surfaceFileTiers(entries, paths);
  return paths
    .filter((path) => {
      if (scannable.has(path)) return scannable.get(path) === tier;
      if (/\.(test|spec)\.tsx?$/.test(path)) return false;
      const tiers = entries.filter((e) => (e.path.endsWith("/") ? path.startsWith(e.path) : path === e.path)).map((e) => e.tier);
      return tiers.length > 0 && Math.min(...tiers) === tier;
    })
    .sort();
}

/** Rounds of another release can't be signed any more; moved aside so their areas are free on this one. */
async function archiveStale(deps: Deps, rounds: readonly Round[], commit: string): Promise<string[]> {
  const notes: string[] = [];
  for (const round of rounds) {
    if (round.challenge === undefined || round.challenge.commit === commit) continue;
    const to = `${SCAN_DIR}/v${round.challenge.release}/${round.area}`;
    await rm(join(deps.root, to), { recursive: true, force: true });
    await mkdir(join(deps.root, dirname(to)), { recursive: true });
    await rename(join(deps.root, round.paths.dir), join(deps.root, to));
    notes.push(`Moved the ${round.label} round of v${round.challenge.release} to ${to}/.`);
  }
  return notes;
}

/** No area is free here: end on "file" while rounds wait, else on the wallet having scanned them all. */
async function noAreaLeft(deps: Deps, release: string, rounds: readonly Round[]): Promise<Outcome> {
  const waiting = rounds.filter((round) => round.status === "waiting");
  const { unfiled: reports } = await sumReports(deps, waiting);
  const closing =
    waiting.length > 0
      ? [everyAreaHere(release, waiting.length, reports)]
      : [`This wallet has scanned every area of v${release}; the next release opens new rounds.`];
  return fail(
    "start",
    [{ path: "area", message: `Every area of v${release} is scanned in this checkout, so there is no round to start; end the turn with the message below.` }],
    closingLines(closing),
    closingJson(closing),
  );
}

export async function runStart(deps: Deps, options: { area?: string } = {}): Promise<Outcome> {
  const named = options.area;
  if (named !== undefined && !isScanAreaId(named)) {
    const what = named === "" ? "--area needs an area id" : `${JSON.stringify(named)} isn't a scan area`;
    return fail("start", [{ path: "area", message: `${what}; use one of ${AREA_IDS}, or leave out --area to scan the least-covered one.` }]);
  }
  const head = await gitOrUndefined(deps, ["rev-parse", "HEAD"]);
  if (head === undefined) {
    return fail("start", [{ path: "git", message: "This isn't a git checkout of Gleam; run `pnpm scan start` from inside a git checkout of the latest Gleam release tag." }]);
  }
  const all = await listRounds(deps);
  const here = all.filter((round) => round.challenge?.commit === head);

  let area: ScanAreaId;
  if (named !== undefined) {
    area = named;
    const existing = here.find((round) => round.area === area);
    if (existing?.status === "signed") {
      return fail("start", [{ path: "area", message: `The ${existing.label} round is signed in this checkout; run \`pnpm scan start\` to scan the least-covered area left.` }]);
    }
    if (existing?.status === "waiting") {
      return fail("start", [
        { path: "area", message: `The ${existing.label} round passed \`pnpm scan finish\` and waits to be signed; run \`pnpm scan start\` for another area, or \`pnpm scan file\` to sign.` },
      ]);
    }
  } else {
    // A round left half done (an earlier session, or a check that reopened it) comes before a new one.
    const open = here.find((round) => round.status === "open");
    if (open !== undefined) {
      return fail("start", [
        {
          path: "round",
          message: `The ${open.label} round is open in ${open.paths.dir}/; finish it (security/scan/SKILL.md § Resumed session) and run \`pnpm scan finish --area ${open.area}\`. If its challenge expired, run \`pnpm scan start --area ${open.area}\` first.`,
        },
      ]);
    }
    const areas = await fetchAreas(deps, "pnpm scan start");
    if (!areas.ok) return fail("start", areas.issues);
    const free = freeAreas(areas.areas, new Set(here.map((round) => round.area)));
    if (free[0] === undefined) return noAreaLeft(deps, areas.release, here);
    area = free[0].id;
  }

  const rerun = named === undefined ? "pnpm scan start" : `pnpm scan start --area ${area}`;
  const fetched = await callApi(deps, `/scan/challenge?area=${area}`, undefined, rerun);
  if (!fetched.ok) return fail("start", fetched.issues);
  if (!isChallengeResponse(fetched.body) || fetched.body.functions.length === 0) {
    return fail("start", [shapeProblem("challenge", "a challenge", rerun)]);
  }
  const challenge = fetched.body;
  if (head !== challenge.commit) {
    return fail("start", [
      {
        path: "git",
        message: `HEAD is ${head.slice(0, 7)} but the latest release is v${challenge.release} (${challenge.commit.slice(0, 7)}); run \`git fetch --tags && git checkout v${challenge.release} && pnpm install --frozen-lockfile\`, then \`${rerun}\` again.`,
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
        message: `\`${fn.symbol}\` isn't in ${fn.file} at ${challenge.commit.slice(0, 7)}; run \`git fetch --tags\` and \`${rerun}\` again, and if it persists tell the user the challenge is broken.`,
      });
    } else spans.push({ ...fn, startLine: span.startLine, endLine: span.endLine });
  }
  if (problems.length > 0) return fail("start", problems);

  const chosen = scanArea(challenge.area);
  const paths = roundPaths(challenge.area);
  const surface = await showAtCommit(deps, challenge.commit, "security/surface.txt");
  const tracked = (await gitOrUndefined(deps, ["ls-files"]))?.split("\n").filter(Boolean) ?? [];
  const files = surface === undefined ? [] : areaFiles(parseSurfaceText(surface), tracked, chosen.tier);

  const notes = await archiveStale(deps, all, challenge.commit);
  const startedAt = deps.now();
  await writeJson(deps, paths.challenge, challenge);
  await writeText(deps, paths.startedAt, `${startedAt}\n`);
  await writeText(deps, paths.areaFiles, files.map((file) => `${file}\n`).join(""));
  await writeText(deps, CURRENT_FILE, `${challenge.area}\n`);
  const existingText = await readText(deps, paths.attestation);
  let keep = false;
  if (existingText !== undefined) {
    const existing = parseJsonOrUndefined(existingText);
    const old = (existing as { challenge?: unknown } | null | undefined)?.challenge;
    keep = old === challenge.challenge;
    if (!keep) {
      const label = typeof old === "string" && /^[A-Za-z0-9_-]+$/.test(old) ? old : "unreadable";
      const backup = `${paths.dir}/attestation.${label}.json`;
      await writeText(deps, backup, existingText);
      notes.push(`Backed up the previous ${paths.attestation} to ${backup}.`);
    }
  }
  if (!keep) {
    await writeJson(deps, paths.attestation, {
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
    files.length === 0
      ? `Area: ${chosen.label} (${chosen.id}, tier ${chosen.tier}).`
      : `Area: ${chosen.label} (${chosen.id}, tier ${chosen.tier}). Review these ${files.length} files first, then follow anything they reach:`,
    ...files.map((file) => `    ${file}`),
    "Answer these functions. Lines are checked against the committed file (`git show <commit>:<file>`), not your working tree.",
    ...spans.map((s, i) => `  ${i + 1}. ${s.file}  ${s.symbol}  lines ${s.startLine}-${s.endLine}`),
    `Started: ${new Date(startedAt).toISOString()}`,
    `Expires: ${challenge.expiresAt}`,
    ...notes,
    `Round folder: ${paths.dir}/`,
    keep ? `Kept your ${paths.attestation}.` : `Wrote ${paths.challenge}, ${paths.areaFiles} and a starter ${paths.attestation}.`,
    "Next:",
    `  1. Scan the ${chosen.label} area (security/scan/SKILL.md § Round brief). Leads, candidates and drafts go in ${paths.dir}/.`,
    `  2. Edit ${paths.attestation}: per answer set line (a line in the function body that makes a security check) and check (one sentence on what it prevents); set model, result ("pass" or "scanned") and report.`,
    "  3. Run `pnpm scan finish`.",
  ];
  return {
    ok: true,
    command: "start",
    lines,
    issues: [],
    json: { challenge: { ...challenge, functions: spans }, area: { ...chosen, files }, folder: paths.dir },
  };
}
