import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { formatPoints } from "../../packages/app/src/screens/points/src/formatPoints.ts";
import {
  CHALLENGE_SIZE,
  SCAN_AREAS,
  encodeAttestationPayload,
  isAttestationId,
  isScanAreaId,
  parseAttestation,
  scanArea,
  type ParsedAttestation,
  type ScanAreaId,
} from "../../packages/core/src/scan/index.ts";
import { callApi, type ApiResult } from "./api.ts";
import { advisoryDrafts, prDrafts } from "./readability.ts";
import {
  ROUNDS_DIR,
  isChallengeResponse,
  plural,
  readJson,
  readText,
  roundPaths,
  type ChallengeResponse,
  type Deps,
} from "./shared.ts";

/** `signed.json`: what `GET /scan/next` said once the server had the round's signature. */
export interface SignedRecord {
  attestationId: string;
  /** Null for a scan the server recorded before rounds. */
  round: number | null;
  points: string;
}

export type RoundStatus = "open" | "waiting" | "signed";

/**
 * One area's round in this checkout. **Open** until `finish` passes,
 * **waiting** from then until `next` sees the signature, then **signed**.
 */
export interface Round {
  area: ScanAreaId;
  label: string;
  paths: ReturnType<typeof roundPaths>;
  challenge: ChallengeResponse | undefined;
  startedAt: number | undefined;
  signed: SignedRecord | undefined;
  status: RoundStatus;
}

const ATOMIC = /^\d{1,40}$/;

function isSignedRecord(value: unknown): value is SignedRecord {
  const v = value as Record<string, unknown> | null;
  return (
    v !== null &&
    typeof v === "object" &&
    typeof v.attestationId === "string" &&
    isAttestationId(v.attestationId) &&
    (v.round === null || (Number.isInteger(v.round) && (v.round as number) >= 1)) &&
    typeof v.points === "string" &&
    ATOMIC.test(v.points)
  );
}

export async function readRound(deps: Deps, area: ScanAreaId): Promise<Round> {
  const paths = roundPaths(area);
  const challenge = await readJson(deps, paths.challenge);
  const started = Number((await readText(deps, paths.startedAt))?.trim());
  const signed = await readJson(deps, paths.signed);
  const finished = (await readText(deps, paths.finished)) !== undefined;
  const signedRecord = isSignedRecord(signed) ? signed : undefined;
  return {
    area,
    label: scanArea(area).label,
    paths,
    challenge: isChallengeResponse(challenge) ? challenge : undefined,
    startedAt: Number.isFinite(started) && started > 0 ? started : undefined,
    signed: signedRecord,
    status: signedRecord ? "signed" : finished ? "waiting" : "open",
  };
}

/** Every round folder in this checkout, in the order the rounds started (signing order). */
export async function listRounds(deps: Deps): Promise<Round[]> {
  let names: string[];
  try {
    names = await readdir(join(deps.root, ROUNDS_DIR));
  } catch {
    return [];
  }
  const rounds = await Promise.all(names.filter(isScanAreaId).map((area) => readRound(deps, area)));
  const tier = (round: Round) => scanArea(round.area).tier;
  return rounds.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || tier(a) - tier(b));
}

/** The wallet's last signed round number known here, from `signed.json`; 0 before any. */
export function signedRoundBase(rounds: readonly Round[]): number {
  return rounds.reduce((max, round) => Math.max(max, round.signed?.round ?? (round.signed ? 1 : 0)), 0);
}

/** The round's attestation, if `finish` has filled it in. */
export async function roundAttestation(deps: Deps, round: Round): Promise<{ attestation: ParsedAttestation; payload: string } | undefined> {
  const parsed = parseAttestation(await readJson(deps, round.paths.attestation));
  return parsed.ok ? { attestation: parsed.attestation, payload: encodeAttestationPayload(parsed.attestation) } : undefined;
}

/** The round's advisory and PR drafts, and how many of them `filed.txt` lists as filed. */
export async function roundReports(deps: Deps, round: Round): Promise<{ drafts: string[]; unfiled: number; filed: number }> {
  const drafts = [...(await advisoryDrafts(deps, round.paths.dir)), ...(await prDrafts(deps, round.paths.dir))];
  const listed = new Set(
    ((await readText(deps, round.paths.filed)) ?? "")
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0] ?? "")
      .filter(Boolean),
  );
  const filed = drafts.filter((draft) => listed.has(draft.slice(draft.lastIndexOf("/") + 1))).length;
  return { drafts, unfiled: drafts.length - filed, filed };
}

/** One area of `GET /scan/areas`. */
export interface AreaSummary {
  id: ScanAreaId;
  label: string;
  tier: number;
  functions: number;
  examined: number;
}

function isAreasResponse(value: unknown): value is { release: string; areas: AreaSummary[] } {
  const v = value as Record<string, unknown> | null;
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  return (
    v !== null &&
    typeof v === "object" &&
    typeof v.release === "string" &&
    Array.isArray(v.areas) &&
    v.areas.every((a) => {
      const area = a as Record<string, unknown> | null;
      return area !== null && typeof area === "object" && isScanAreaId(area.id) && typeof area.label === "string" && count(area.functions) && count(area.examined);
    })
  );
}

export async function fetchAreas(deps: Deps, rerun: string): Promise<{ ok: true; release: string; areas: AreaSummary[] } | Extract<ApiResult, { ok: false }>> {
  const fetched = await callApi(deps, "/scan/areas", undefined, rerun);
  if (!fetched.ok) return fetched;
  if (!isAreasResponse(fetched.body)) {
    return {
      ok: false,
      issues: [{ path: "areas", message: `The points API sent the areas in an unexpected shape; update this checkout (\`git fetch --tags\`) and run \`${rerun}\` again.` }],
    };
  }
  return { ok: true, release: fetched.body.release, areas: fetched.body.areas.map((a) => ({ ...a, tier: scanArea(a.id).tier })) };
}

/** The server's order: smallest examined share first, then lower tier. Cross-multiplied so no float decides it. */
export function byLeastCovered(a: AreaSummary, b: AreaSummary): number {
  return a.examined * b.functions - b.examined * a.functions || a.tier - b.tier;
}

/**
 * Areas with no round folder here, least covered first. Without the
 * server's figures it falls back to tier order and leaves the counts out.
 */
export function freeAreas(areas: readonly AreaSummary[] | undefined, taken: ReadonlySet<ScanAreaId>): Suggestion[] {
  if (areas === undefined) return SCAN_AREAS.filter((area) => !taken.has(area.id)).map((area) => ({ id: area.id, label: area.label }));
  return areas
    .filter((area) => area.functions >= CHALLENGE_SIZE && !taken.has(area.id))
    .sort(byLeastCovered)
    .map(({ id, label, functions, examined }) => ({ id, label, functions, examined }));
}

/** The area a round offer names; `functions` and `examined` are left out when the server's figures are unknown. */
export interface Suggestion {
  id: ScanAreaId;
  label: string;
  functions?: number;
  examined?: number;
}

function coverageClause(area: Suggestion): string {
  if (area.functions === undefined || area.examined === undefined) return `${area.label} is next`;
  const unexamined = area.functions - area.examined;
  if (unexamined <= 0) return `${area.label} is the least-covered area left`;
  if (area.examined === 0) return `nobody has examined any of the ${area.functions} functions in ${area.label} yet`;
  return `nobody has examined ${unexamined} of the ${area.functions} functions in ${area.label} yet`;
}

/** `amountAtomic` undefined means the reward couldn't be read. */
function rewardClause(round: number, amountAtomic: string | undefined): string {
  if (amountAtomic === undefined) return `Round ${round} earns points even with no findings`;
  if (amountAtomic === "0") return `Round ${round} is recorded but earns no points`;
  return `Round ${round} earns ${formatPoints(amountAtomic)} points even with no findings`;
}

const pointsText = (atomic: string) => (atomic === "0" ? "no points" : `${formatPoints(atomic)} points`);

function signList(rounds: number, reports: number): string {
  const what = rounds === 1 ? "the round" : `the ${rounds} rounds`;
  return reports > 0 ? `${what} and file ${plural(reports, "report")}` : what;
}

/** `finish`'s closing message: this round is ready, and the next one or "file". */
export function roundOffer(input: {
  round: number;
  label: string;
  release: string;
  waiting: number;
  reports: number;
  nextRound: number;
  nextAmountAtomic: string | undefined;
  suggestion: Suggestion | undefined;
}): string[] {
  const ready = `Round ${input.round} (${input.label}) is ready.`;
  if (input.suggestion === undefined) return [`${ready} ${everyAreaHere(input.release, input.waiting, input.reports)}`];
  const waiting =
    input.reports > 0
      ? `${plural(input.waiting, "round")} and ${plural(input.reports, "report")} are waiting to be signed.`
      : `${plural(input.waiting, "round")} ${input.waiting === 1 ? "is" : "are"} waiting to be signed.`;
  const offer = `${rewardClause(input.nextRound, input.nextAmountAtomic)}, and ${coverageClause(input.suggestion)}.`;
  return [`${ready} ${waiting} ${offer} Reply "next" to scan it, or "file" to sign and file everything.`];
}

/** Every area has a round here, so "file" is the only reply left. */
export function everyAreaHere(release: string, waiting: number, reports: number): string {
  return `Every area of v${release} is done in this checkout. Reply "file" to sign ${signList(waiting, reports)}.`;
}

/** `file`'s closing message, and `next`'s while a round is unsigned. */
export function signRequest(input: { rounds: number; link: string; unfiled: number; filed: number }): string[] {
  const { rounds, link, unfiled, filed } = input;
  const head =
    unfiled > 0
      ? `${plural(rounds, "round")} ${rounds === 1 ? "is" : "are"} ready to sign, with ${plural(unfiled, "report")} to file.`
      : `${plural(rounds, "round")} ${rounds === 1 ? "is" : "are"} ready to sign.`;
  const reply =
    unfiled > 0
      ? // Names each gh action, so this one question is the "ask me before any gh action" the scan prompt requires.
        `2. Reply "signed" and I'll file ${unfiled === 1 ? "the report" : "the reports"}: fork, push, open each PR and file each advisory.`
      : filed > 0
        ? `2. Reply "signed" and I'll add the attestation ${rounds === 1 ? "id" : "ids"} to the filed ${filed === 1 ? "report" : "reports"}.`
        : `2. Reply "signed" when you're done.`;
  return [head, "", `1. Open this link and sign ${rounds === 1 ? "it" : "each round"} in Gleam: ${link}`, reply];
}

/** `next`'s closing message once every round here is signed. */
export function nextOffer(input: {
  signedRounds: number;
  pointsAtomic: string;
  release: string;
  nextRound: number;
  nextAmountAtomic: string;
  suggestion: Suggestion | undefined;
}): string[] {
  const earned = `Signed: ${plural(input.signedRounds, "round")} earned ${pointsText(input.pointsAtomic)}.`;
  if (input.suggestion === undefined) {
    return [`${earned} This wallet has scanned every area of v${input.release}; the next release opens new rounds.`];
  }
  return [`${earned} ${rewardClause(input.nextRound, input.nextAmountAtomic)}, and ${coverageClause(input.suggestion)}. Reply "next" to scan it.`];
}

/** The `attest.html` link for several rounds: each payload in signing order, joined with `.`. */
export function attestLink(deps: Deps, payloads: readonly string[]): string {
  return `${deps.siteUrl.replace(/\/*$/, "/")}attest.html#${payloads.join(".")}`;
}
