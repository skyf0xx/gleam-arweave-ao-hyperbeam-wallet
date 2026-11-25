import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  attestationId,
  checkAnswers,
  findFunction,
  isJsxPath,
  isScanAreaId,
  parseAttestation,
  roundReward,
  scanArea,
  type ParsedAttestation,
  type AttestationAnswer,
  type ScanAreaId,
  type ScanIssue,
} from "../../packages/core/src/scan/index.ts";
import { callApi } from "./api.ts";
import { draftProblems } from "./drafts.ts";
import { draftWarnings } from "./readability.ts";
import {
  fetchAreas,
  freeAreas,
  listRounds,
  roundOffer,
  signedRoundBase,
  sumReports,
} from "./rounds.ts";
import {
  ATOMIC,
  closingJson,
  closingLines,
  fail,
  formatElapsed,
  gitOrUndefined,
  isChallengeResponse,
  jsonParseProblem,
  parseJsonOrUndefined,
  readCurrent,
  readText,
  roundPaths,
  showAtCommit,
  writeJson,
  type ChallengeResponse,
  type Deps,
  type Outcome,
  type Problem,
} from "./shared.ts";

/** Server codes that mean the round's challenge can't be signed any more, so the area has to be answered again. */
const DEAD_CHALLENGE = new Set(["challenge_unknown", "challenge_expired", "challenge_used", "challenge_wrong_release", "challenge_wrong_commit"]);

export type Validated =
  | { ok: false; notes: string[]; issues: Problem[] }
  | { ok: true; notes: string[]; attestation: ParsedAttestation; id: string; challenge: ChallengeResponse; paidPlacesLeft: number | undefined };

/** A failure that says nothing about the round: retrying the same command can pass. */
export function isTransient(issue: Problem): boolean {
  return (
    issue.path === "network" ||
    issue.path === "rate_limited" ||
    issue.path.startsWith("http_") ||
    issue.code === "rate_limited" ||
    issue.code === "github_unavailable"
  );
}

/** A failure that means the round's challenge can't be signed, so the area has to be answered again. */
export function isDeadChallenge(issue: Problem): boolean {
  return issue.code !== undefined && DEAD_CHALLENGE.has(issue.code);
}

/**
 * Checks one round's attestation locally, then with `POST /attestations/check`.
 * `then` is what the agent runs after re-answering a dead challenge. A round
 * the check rejects is open again, so `start` may replace its challenge; a
 * network or server hiccup leaves it waiting, or a retry would drop it.
 */
export async function validateRound(deps: Deps, area: ScanAreaId, rerun: string, then: string): Promise<Validated> {
  const result = await validate(deps, area, rerun, then);
  if (!result.ok && !result.issues.every(isTransient)) await rm(join(deps.root, roundPaths(area).finished), { force: true });
  return result;
}

async function validate(deps: Deps, area: ScanAreaId, rerun: string, then: string): Promise<Validated> {
  const paths = roundPaths(area);
  const restart = `run \`pnpm scan start --area ${area}\`, answer its 3 new functions, copy model, result and report from the backup it names, then run ${then}`;
  const failed = (issues: Problem[], notes: string[] = []): Validated => ({ ok: false, notes, issues });

  const challengeText = await readText(deps, paths.challenge);
  if (challengeText === undefined) {
    return failed([{ path: paths.challenge, message: `There is no challenge for ${scanArea(area).label}; run \`pnpm scan start --area ${area}\` first.` }]);
  }
  const challengeJson = parseJsonOrUndefined(challengeText);
  if (!isChallengeResponse(challengeJson)) {
    return failed([{ path: paths.challenge, message: `${paths.challenge} is unreadable; run \`pnpm scan start --area ${area}\` again.` }]);
  }
  const challenge: ChallengeResponse = challengeJson;

  const text = await readText(deps, paths.attestation);
  if (text === undefined) {
    return failed([{ path: paths.attestation, message: `There is no attestation file; run \`pnpm scan start --area ${area}\` first.` }]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return failed([jsonParseProblem(paths.attestation, text, error)]);
  }

  const issues: Problem[] = [];
  const notes: string[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  // Release, commit and challenge come from git and challenge.json, not from the agent.
  const draft: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const head = await gitOrUndefined(deps, ["rev-parse", "HEAD"]);
  if (head === undefined) {
    push("git", `This isn't a git checkout; run \`${rerun}\` from the Gleam checkout you scanned.`);
  } else {
    const tags = (await gitOrUndefined(deps, ["tag", "--points-at", "HEAD"]))?.split("\n").map((t) => t.trim()) ?? [];
    const releases = tags.flatMap((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1] ?? []);
    const release = releases.includes(challenge.release) ? challenge.release : releases[0];
    if (release === undefined) {
      push("git", `HEAD (${head.slice(0, 7)}) has no v<x.y.z> release tag; run \`git checkout v${challenge.release}\` and \`${rerun}\` again.`);
    } else {
      fill(draft, "release", release, notes);
      fill(draft, "commit", head, notes);
    }
    if (head !== challenge.commit || (release !== undefined && release !== challenge.release)) {
      push(
        "commit",
        `HEAD is ${head.slice(0, 7)} but the challenge is for v${challenge.release} (${challenge.commit.slice(0, 7)}); run \`git checkout v${challenge.release}\` and \`${rerun}\` again.`,
      );
    }
  }
  if (draft.challenge === undefined || draft.challenge === "") draft.challenge = challenge.challenge;
  else if (draft.challenge !== challenge.challenge) {
    push("challenge", `challenge differs from ${paths.challenge}; set it to "${challenge.challenge}".`);
  }

  // Code at the attested commit, for the answer check and for naming line spans.
  const commit = head ?? challenge.commit;
  const files = new Map<string, string>();
  const filePaths = new Set(challenge.functions.map((fn) => fn.file));
  if (Array.isArray(draft.answers)) {
    for (const answer of draft.answers) {
      const file = (answer as { file?: unknown } | null)?.file;
      if (typeof file === "string") filePaths.add(file);
    }
  }
  for (const file of filePaths) {
    const content = await showAtCommit(deps, commit, file);
    if (content !== undefined) files.set(file, content);
  }

  const placeholderPaths = new Set<string>();
  const placeholder = (path: string, message: string) => {
    placeholderPaths.add(path);
    push(path, message);
  };
  if (draft.model === "") placeholder("model", "model is empty; set it to your model name, such as claude-opus-5-5.");
  if (draft.report === "") placeholder("report", "report is empty; write markdown on what you checked and what you didn't.");
  if (Array.isArray(draft.answers)) {
    draft.answers.forEach((answer, index) => {
      const a = answer as Record<string, unknown> | null;
      if (a === null || typeof a !== "object") return;
      const at = `answers[${index}]`;
      if (a.line === 0) {
        const span =
          typeof a.file === "string" && typeof a.symbol === "string" && files.has(a.file)
            ? findFunction(files.get(a.file)!, a.symbol, { jsx: isJsxPath(a.file) })
            : undefined;
        const range = span ? ` (lines ${span.bodyStartLine + 1}-${span.endLine - 1})` : "";
        placeholder(`${at}.line`, `${at}.line is 0; set it to the line of a security check in the body of \`${String(a.symbol)}\`${range}.`);
      }
      if (a.check === "") placeholder(`${at}.check`, `${at}.check is empty; write one sentence on what the cited line prevents.`);
    });
  }

  // Core checks: shape first, then the answers against the committed code.
  const core: ScanIssue[] = [];
  const parsed = parseAttestation(draft);
  if (!parsed.ok) core.push(...parsed.issues);
  const answers = Array.isArray(draft.answers) ? draft.answers : undefined;
  if (answers && answers.every(isLooseAnswer)) {
    core.push(...checkAnswers(answers as AttestationAnswer[], challenge.functions, files));
  }
  const seen = new Set<string>();
  for (const issue of core) {
    const key = `${issue.path}\n${issue.message}`;
    if (placeholderPaths.has(issue.path) || seen.has(key)) continue;
    seen.add(key);
    push(issue.path, issue.message);
  }

  if (deps.now() >= Date.parse(challenge.expiresAt)) push("challenge", `The challenge expired at ${challenge.expiresAt}; ${restart}.`);
  issues.push(...(await draftProblems(deps, paths.dir, commit)));
  if (issues.length > 0 || !parsed.ok) return failed(issues, notes);

  // Local checks pass, so ask the server (latest release, unexpired and unused challenge).
  const attestation = parsed.attestation;
  const sent = await callApi(
    deps,
    "/attestations/check",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attestation }) },
    rerun,
  );
  if (!sent.ok) {
    // The server's sentence says "run `pnpm scan start`", which would start another area; name this one.
    const fixed = sent.issues.map((issue) =>
      isDeadChallenge(issue)
        ? { ...issue, message: `${issue.message.replace(/;.*$/, "")}; ${restart}.` }
        : issue,
    );
    return failed(fixed, notes);
  }
  const result = sent.body as { attestationId?: unknown; paidPlacesLeft?: unknown } | null;
  const id = await attestationId(attestation);
  if (typeof result?.attestationId !== "string" || result.attestationId !== id) {
    return failed([
      { path: "attestationId", message: `The server computed a different attestation id than this checkout; update the checkout (\`git pull\`) and run \`${rerun}\` again.` },
    ]);
  }
  await writeJson(deps, paths.attestation, attestation);
  return {
    ok: true,
    notes,
    attestation,
    id,
    challenge,
    paidPlacesLeft: typeof result.paidPlacesLeft === "number" ? result.paidPlacesLeft : undefined,
  };
}

/** `GET /scan/rewards`, or undefined when it can't be read: the offer then leaves the amount out. */
async function fetchRewards(deps: Deps): Promise<{ day: string | null; full: string } | undefined> {
  const fetched = await callApi(deps, "/scan/rewards", undefined, "pnpm scan finish");
  const body = fetched.ok ? (fetched.body as Record<string, unknown> | null) : null;
  const atomic = (v: unknown): v is string => typeof v === "string" && ATOMIC.test(v);
  if (!body || !atomic(body.scanRewardAtomic)) return undefined;
  return { day: typeof body.day === "string" ? body.day : null, full: body.scanRewardAtomic };
}

/** Resolves `--area`, or the current round, to an area id. */
export async function resolveArea(deps: Deps, command: Outcome["command"], area: string | undefined): Promise<ScanAreaId | Outcome> {
  if (area !== undefined) {
    if (isScanAreaId(area)) return area;
    const named = area === "" ? "--area needs an area id" : `${JSON.stringify(area)} isn't a scan area`;
    return fail(command, [{ path: "area", message: `${named}; use the area \`pnpm scan start\` printed, or leave out --area for the current round.` }]);
  }
  const current = await readCurrent(deps);
  if (current === undefined) return fail(command, [{ path: "round", message: "There is no round yet; run `pnpm scan start` first." }]);
  return current;
}

export async function runFinish(deps: Deps, options: { area?: string } = {}): Promise<Outcome> {
  const area = await resolveArea(deps, "finish", options.area);
  if (typeof area !== "string") return area;
  const paths = roundPaths(area);
  const label = scanArea(area).label;
  if ((await readText(deps, paths.signed)) !== undefined) {
    return fail("finish", [{ path: "round", message: `The ${label} round is signed already; run \`pnpm scan next\`.` }]);
  }

  const rerun = options.area === undefined ? "pnpm scan finish" : `pnpm scan finish --area ${area}`;
  const checked = await validateRound(deps, area, rerun, `\`pnpm scan finish --area ${area}\``);
  if (!checked.ok) return fail("finish", checked.issues, checked.notes);
  const { attestation, id, paidPlacesLeft } = checked;
  await writeJson(deps, paths.finished, { attestationId: id });

  const rounds = await listRounds(deps);
  const waiting = rounds.filter((round) => round.status === "waiting");
  const base = signedRoundBase(rounds);
  const number = base + waiting.findIndex((round) => round.area === area) + 1;
  const { unfiled: reports } = await sumReports(deps, waiting);

  const taken = new Set(rounds.map((round) => round.area));
  const areas = await fetchAreas(deps, rerun);
  const suggestion = freeAreas(areas.ok ? areas.areas : undefined, taken)[0];
  const nextRound = base + waiting.length + 1;
  let nextAmountAtomic: string | undefined;
  if (suggestion !== undefined) {
    // Every waiting round takes a paid place when it is signed, before the next round does.
    const placesAfter = paidPlacesLeft === undefined ? undefined : paidPlacesLeft - waiting.length;
    if (placesAfter !== undefined && placesAfter <= 0) nextAmountAtomic = "0";
    else {
      const rewards = await fetchRewards(deps);
      if (rewards !== undefined) {
        nextAmountAtomic = roundReward(BigInt(rewards.full), nextRound).toString();
      }
    }
  }

  const startedAt = Number((await readText(deps, paths.startedAt))?.trim());
  const elapsedMs = Number.isFinite(startedAt) && startedAt > 0 ? deps.now() - startedAt : undefined;
  const warnings = await draftWarnings(deps, paths.dir);
  const closing = roundOffer({
    round: number,
    label,
    release: attestation.release,
    waiting: waiting.length,
    reports,
    nextRound,
    nextAmountAtomic,
    suggestion,
  });
  const lines = [
    ...checked.notes,
    `Attestation valid for Gleam v${attestation.release}, area ${label}.`,
    `Attestation id: ${id}`,
    ...(elapsedMs === undefined ? [] : [`Scan time: ${formatElapsed(elapsedMs)}.`]),
    ...(paidPlacesLeft === undefined ? [] : [`Paid places left: ${paidPlacesLeft}`]),
    ...(paidPlacesLeft === 0 ? ["Warning: no paid places are left, so this round will be recorded but earns no points."] : []),
    ...warnings,
    ...closingLines(closing),
  ];
  return {
    ok: true,
    command: "finish",
    lines,
    issues: [],
    json: {
      area,
      round: number,
      challenge: checked.challenge.challenge,
      attestationId: id,
      waiting: waiting.map((round) => round.area),
      ...(suggestion === undefined ? {} : { suggested: suggestion.id }),
      ...(nextAmountAtomic === undefined ? {} : { nextRound, nextRewardAtomic: nextAmountAtomic }),
      ...(warnings.length === 0 ? {} : { warnings }),
      ...(elapsedMs === undefined ? {} : { elapsedMs, elapsed: formatElapsed(elapsedMs) }),
      ...(paidPlacesLeft === undefined ? {} : { paidPlacesLeft }),
      ...closingJson(closing),
    },
  };
}

function fill(draft: Record<string, unknown>, key: "release" | "commit", value: string, notes: string[]): void {
  const old = draft[key];
  if (old !== undefined && old !== "" && old !== value) {
    notes.push(`Replaced ${key} ${JSON.stringify(old)} with ${value} from git.`);
  }
  draft[key] = value;
}

function isLooseAnswer(value: unknown): boolean {
  const a = value as Record<string, unknown> | null;
  return a !== null && typeof a === "object" && typeof a.file === "string" && typeof a.symbol === "string" && typeof a.line === "number";
}
