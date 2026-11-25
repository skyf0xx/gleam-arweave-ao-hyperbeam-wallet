import { attestationId, encodeAttestationPayload } from "../../packages/core/src/scan/index.ts";
import { callApi } from "./api.ts";
import { validateRound } from "./finish.ts";
import { isNextResponse, signedRecord } from "./next.ts";
import { draftWarnings } from "./readability.ts";
import { attestLink, listRounds, roundAttestation, signRequest, signedRoundBase, sumReports, type Round } from "./rounds.ts";
import { closingJson, closingLines, declinesLine, fail, readDeclines, writeJson, type Deps, type Outcome, type Problem } from "./shared.ts";

/** Re-checks every waiting round and prints one link that signs them all, in round order. */
export async function runFile(deps: Deps): Promise<Outcome> {
  const rounds = await listRounds(deps);
  const waiting = rounds.filter((round) => round.status === "waiting");
  if (waiting.length === 0) {
    const message = rounds.length > 0 && rounds.every((round) => round.status === "signed")
      ? "Every round in this checkout is signed; run `pnpm scan next`."
      : "No round has passed `pnpm scan finish` yet; fill in the round's attestation and run `pnpm scan finish` first.";
    return fail("file", [{ path: "rounds", message }]);
  }

  const issues: Problem[] = [];
  const notes: string[] = [];
  const ready: { round: Round; id: string; payload: string }[] = [];
  for (const round of waiting) {
    const checked = await validateRound(deps, round.area, "pnpm scan file", `\`pnpm scan finish --area ${round.area}\` and \`pnpm scan file\` again`);
    if (checked.ok) {
      ready.push({ round, id: checked.id, payload: encodeAttestationPayload(checked.attestation) });
      continue;
    }
    // A used challenge usually means the user signed this round already; `next` would have recorded it.
    if (checked.issues.some((issue) => issue.code === "challenge_used") && (await recordIfSigned(deps, round))) {
      notes.push(`The ${round.label} round is signed already; \`pnpm scan next\` reports it.`);
      continue;
    }
    notes.push(...checked.notes.map((note) => `${round.area}: ${note}`));
    issues.push(...checked.issues.map((issue) => ({ ...issue, path: `${round.area} ${issue.path}` })));
  }
  if (issues.length > 0) return fail("file", issues, notes);
  if (ready.length === 0) return fail("file", [{ path: "rounds", message: "Every round in this checkout is signed; run `pnpm scan next`." }]);

  const base = signedRoundBase(await listRounds(deps));
  const { unfiled, filed } = await sumReports(deps, ready.map((r) => r.round));
  const lines = [...notes];
  const warnings: string[] = [];
  for (const [i, { round, id }] of ready.entries()) {
    lines.push(`Round ${base + i + 1} (${round.label}): attestation ${id}, drafts in ${round.paths.dir}/.`);
    warnings.push(...(await draftWarnings(deps, round.paths.dir)));
  }
  const link = attestLink(deps, ready.map((r) => r.payload));
  const closing = signRequest({ rounds: ready.length, link, unfiled, filed });
  const declines = await readDeclines(deps);
  lines.push(...warnings, ...(declines > 0 ? [declinesLine(declines)] : []), ...closingLines(closing));
  return {
    ok: true,
    command: "file",
    lines,
    issues: [],
    json: {
      rounds: ready.map(({ round, id }, i) => ({ area: round.area, round: base + i + 1, attestationId: id, folder: round.paths.dir })),
      link,
      declines,
      ...(warnings.length === 0 ? {} : { warnings }),
      ...closingJson(closing),
    },
  };
}

async function recordIfSigned(deps: Deps, round: Round): Promise<boolean> {
  const current = await roundAttestation(deps, round);
  if (current === undefined) return false;
  const id = await attestationId(current.attestation);
  const fetched = await callApi(deps, `/scan/next?attestation=${id}`, undefined, "pnpm scan file");
  if (!fetched.ok || !isNextResponse(fetched.body)) return false;
  await writeJson(deps, round.paths.signed, signedRecord(id, fetched.body));
  return true;
}
