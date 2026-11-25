import { attestationId, isScanAreaId, type ScanAreaId } from "../../packages/core/src/scan/index.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { callApi } from "./api.ts";
import { isTransient, validateRound } from "./finish.ts";
import {
  attestLink,
  listRounds,
  nextOffer,
  pointsText,
  roundAttestation,
  signRequest,
  sumReports,
  type Round,
  type SignedRecord,
} from "./rounds.ts";
import {
  ATOMIC,
  DECLINES_FILE,
  closingJson,
  closingLines,
  declinesLine,
  fail,
  plural,
  readDeclines,
  shapeProblem,
  writeJson,
  type Deps,
  type Outcome,
  type Problem,
} from "./shared.ts";

export interface AreaLeft {
  id: ScanAreaId;
  label: string;
  functions: number;
  examined: number;
}

/** `GET /scan/next`: the round the signed attestation was, and what the wallet's next round earns. */
export interface NextResponse {
  release: string;
  /** Null for a whole-surface scan made before areas existed. */
  area: ScanAreaId | null;
  /** Null for a scan made before rounds. */
  round: number | null;
  points: string;
  nextRound: number;
  nextRewardAtomic: string;
  nextPaid: boolean;
  areasLeft: AreaLeft[];
  suggested: ScanAreaId | null;
}

export function isNextResponse(value: unknown): value is NextResponse {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  return (
    typeof v.release === "string" &&
    (v.area === null || isScanAreaId(v.area)) &&
    (v.round === null || (Number.isInteger(v.round) && (v.round as number) >= 1)) &&
    typeof v.points === "string" &&
    ATOMIC.test(v.points) &&
    Number.isInteger(v.nextRound) &&
    typeof v.nextRewardAtomic === "string" &&
    ATOMIC.test(v.nextRewardAtomic) &&
    typeof v.nextPaid === "boolean" &&
    (v.suggested === null || isScanAreaId(v.suggested)) &&
    Array.isArray(v.areasLeft) &&
    v.areasLeft.every((a) => {
      const area = a as Record<string, unknown> | null;
      return area !== null && typeof area === "object" && isScanAreaId(area.id) && typeof area.label === "string" && count(area.functions) && count(area.examined);
    })
  );
}

export function signedRecord(attestationId: string, next: NextResponse): SignedRecord {
  return { attestationId, round: next.round, points: next.points };
}

const SHAPE = shapeProblem("next", "the next round", "pnpm scan next");

type Asked = { kind: "signed"; next: NextResponse } | { kind: "unsigned" } | { kind: "failed"; issues: Problem[] };

async function ask(deps: Deps, id: string): Promise<Asked> {
  const fetched = await callApi(deps, `/scan/next?attestation=${id}`, undefined, "pnpm scan next");
  if (!fetched.ok) {
    return fetched.issues.some((issue) => issue.code === "unknown_attestation") ? { kind: "unsigned" } : { kind: "failed", issues: fetched.issues };
  }
  return isNextResponse(fetched.body) ? { kind: "signed", next: fetched.body } : { kind: "failed", issues: [SHAPE] };
}

const roundName = (round: number | null, label: string) => (round === null ? label : `Round ${round} (${label})`);

/**
 * Records which waiting rounds the user signed. A round still unsigned is
 * checked again as `file` checks it, so a dead challenge gets its fix line
 * instead of a link that can't be signed. Ends with the sign request for the
 * live unsigned rounds, or, once every round here is signed, with the offer
 * of the next round from the server's answer for the last one. Safe to run
 * again at any time: it prints the same closing message.
 */
export async function runNext(deps: Deps): Promise<Outcome> {
  const rounds = await listRounds(deps);
  const waiting = rounds.filter((round) => round.status === "waiting");
  if (waiting.length === 0 && !rounds.some((round) => round.status === "signed")) {
    return fail("next", [{ path: "rounds", message: "No round is waiting to be signed; run `pnpm scan file` and have the user sign first." }]);
  }

  const lines: string[] = [];
  const unsigned: { round: Round; payload: string }[] = [];
  let latest: { round: number; next: NextResponse } | undefined;
  for (const round of waiting) {
    const current = await roundAttestation(deps, round);
    if (current === undefined) {
      return fail("next", [
        { path: round.paths.attestation, message: `${round.paths.attestation} isn't a finished attestation; run \`pnpm scan finish --area ${round.area}\` until it passes, then \`pnpm scan file\`.` },
      ]);
    }
    const id = await attestationId(current.attestation);
    const asked = await ask(deps, id);
    if (asked.kind === "failed") return fail("next", asked.issues);
    if (asked.kind === "unsigned") {
      unsigned.push({ round, payload: current.payload });
      lines.push(`${round.label}: not signed yet (attestation ${id}).`);
      continue;
    }
    await writeJson(deps, round.paths.signed, signedRecord(id, asked.next));
    round.signed = signedRecord(id, asked.next);
    round.status = "signed";
    if (latest === undefined || (asked.next.round ?? 0) >= latest.round) latest = { round: asked.next.round ?? 0, next: asked.next };
    lines.push(`${roundName(asked.next.round, round.label)} is signed: ${pointsText(asked.next.points)}. Attestation id ${id}; drafts in ${round.paths.dir}/.`);
  }

  if (latest !== undefined) await rm(join(deps.root, DECLINES_FILE), { force: true });

  // Re-check what is still unsigned, so the link carries only rounds that can be signed.
  const live: { round: Round; payload: string }[] = [];
  const dead: Problem[] = [];
  for (const entry of unsigned) {
    const { round } = entry;
    const checked = await validateRound(deps, round.area, "pnpm scan next", `\`pnpm scan finish --area ${round.area}\` and \`pnpm scan next\` again`);
    if (checked.ok) live.push(entry);
    else if (checked.issues.every(isTransient)) return fail("next", checked.issues);
    else dead.push(...checked.issues.map((issue) => ({ ...issue, path: `${round.area} ${issue.path}` })));
  }
  if (dead.length > 0) {
    return fail("next", dead, lines, { unsigned: unsigned.map(({ round }) => round.area) });
  }

  if (live.length > 0) {
    const declines = await readDeclines(deps);
    const { unfiled, filed } = await sumReports(deps, live.map(({ round }) => round));
    const names = live.map(({ round }) => round.label);
    const closing = signRequest({ rounds: live.length, link: attestLink(deps, live.map((u) => u.payload)), unfiled, filed });
    return fail(
      "next",
      [
        {
          path: "unsigned",
          message: `${joinNames(names)} ${names.length === 1 ? "isn't" : "aren't"} signed yet; file only the drafts of the signed rounds, and end the turn with the sign request below.`,
        },
      ],
      [...lines, ...(declines > 0 ? [declinesLine(declines)] : []), ...closingLines(closing)],
      { unsigned: live.map(({ round }) => round.area), declines, ...closingJson(closing) },
    );
  }

  // Every round here is signed: the offer comes from the last one's answer, asked again when this run signed none.
  const signed = rounds.filter((round) => round.signed !== undefined);
  if (latest === undefined) {
    const last = signed.reduce((a, b) => ((b.signed!.round ?? 0) >= (a.signed!.round ?? 0) ? b : a));
    const asked = await ask(deps, last.signed!.attestationId);
    if (asked.kind === "failed") return fail("next", asked.issues);
    if (asked.kind === "unsigned") {
      return fail("next", [{ path: last.paths.signed, message: `The server no longer has the ${last.label} round; tell the user, since it may have been voided.` }]);
    }
    latest = { round: asked.next.round ?? 0, next: asked.next };
  }
  const next = latest.next;
  const taken = new Set(rounds.map((round) => round.area));
  // The server leaves out areas signed anywhere; an open round here takes its area too.
  const suggestion = next.areasLeft.find((area) => !taken.has(area.id));
  const points = signed.reduce((sum, round) => sum + BigInt(round.signed!.points), 0n).toString();
  const closing = nextOffer({
    signedRounds: signed.length,
    pointsAtomic: points,
    release: next.release,
    nextRound: next.nextRound,
    nextAmountAtomic: next.nextPaid ? next.nextRewardAtomic : "0",
    suggestion,
  });
  return {
    ok: true,
    command: "next",
    lines: [...(lines.length > 0 ? lines : [`${plural(signed.length, "round")} of Gleam v${next.release} signed in this checkout.`]), ...closingLines(closing)],
    issues: [],
    json: {
      rounds: signed.map((round) => ({ area: round.area, ...round.signed })),
      release: next.release,
      pointsAtomic: points,
      nextRound: next.nextRound,
      nextRewardAtomic: next.nextRewardAtomic,
      nextPaid: next.nextPaid,
      suggested: suggestion?.id ?? null,
      ...closingJson(closing),
    },
  };
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
