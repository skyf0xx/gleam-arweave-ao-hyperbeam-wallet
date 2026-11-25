import { isAttestationId, isScanAreaId, roundReward, type ScanAreaId } from "@gleam/core/src/scan/index.ts";
import { scanReward, walletRoundsDone } from "./attestations";
import { z } from "zod";
import type { Queryable } from "../db";
import { GithubUnavailableError, type GithubClient } from "./github";
import { areaSummaries, areasLeft, walletAreas, type AreaSummary } from "./areas";
import { GITHUB_UNAVAILABLE, NO_RELEASE, failure, type ScanFailure } from "./errors";
import { paidPlaces } from "./places";

/** `GET /scan/areas`: the latest release's areas in tier order. */
export async function listAreas(
  db: Queryable,
  github: GithubClient,
): Promise<{ ok: true; body: { release: string; areas: AreaSummary[] } } | ScanFailure> {
  try {
    const latest = await github.latestRelease();
    if (!latest) return NO_RELEASE;
    const { functions } = await github.filesAt(latest.commit);
    return { ok: true, body: { release: latest.release, areas: await areaSummaries(db, latest.release, functions) } };
  } catch (error) {
    if (error instanceof GithubUnavailableError) return GITHUB_UNAVAILABLE;
    throw error;
  }
}

/** `GET /scan/next`; amounts are atomic-unit integer strings. */
export interface ScanNext {
  release: string;
  /** Null for a whole-surface scan recorded before areas. */
  area: ScanAreaId | null;
  /** Null for a scan recorded before rounds. */
  round: number | null;
  /** What this scan was credited. */
  points: string;
  nextRound: number;
  /** What the next round earns if submitted now; "0" when no paid place or snapshot day is left. */
  nextRewardAtomic: string;
  nextPaid: boolean;
  /** Areas the wallet hasn't scanned, least covered first; empty once the release isn't the latest. */
  areasLeft: { id: ScanAreaId; label: string; functions: number; examined: number }[];
  suggested: ScanAreaId | null;
}

const ATTESTATION_ERROR = "attestation must be an attestation id: 64 lowercase hex characters.";

export const nextQuery = z.object({
  attestation: z.string({ error: ATTESTATION_ERROR }).refine(isAttestationId, { error: ATTESTATION_ERROR }),
});

/** What the wallet that signed `attestation` earned, and what its next round on that release would. */
export async function scanNext(
  db: Queryable,
  github: GithubClient,
  attestation: string,
  now: Date,
): Promise<{ ok: true; body: ScanNext } | ScanFailure> {
  const { rows } = await db.query<{ release: string; address: string; area: string | null; round: number | null; points: string }>(
    `SELECT a.release, a.address, a.area, a.round,
            coalesce((SELECT sum(amount_atomic) FROM scan_points WHERE attestation_id = a.id AND kind = 'scan'), 0)::text AS points
       FROM attestations a WHERE a.id = $1 AND a.voided_at IS NULL`,
    [attestation],
  );
  const row = rows[0];
  if (!row) {
    return failure(
      404,
      "unknown_attestation",
      "attestation",
      "No signed attestation has this id yet; sign it in Gleam from the link `pnpm scan finish` printed, then run `pnpm scan next` again.",
    );
  }

  try {
    const nextRound = (await walletRoundsDone(db, row.address, row.release)) + 1;
    const places = await paidPlaces(db, github, row.release);
    const nextReward = places.left > 0 ? roundReward(await scanReward(db, now), nextRound) : 0n;

    let left: AreaSummary[] = [];
    const latest = await github.latestRelease();
    if (latest?.release === row.release) {
      const { functions } = await github.filesAt(latest.commit);
      left = areasLeft(await areaSummaries(db, row.release, functions), await walletAreas(db, row.address, row.release));
    }
    return {
      ok: true,
      body: {
        release: row.release,
        area: isScanAreaId(row.area) ? row.area : null,
        round: row.round,
        points: row.points,
        nextRound,
        nextRewardAtomic: nextReward.toString(),
        nextPaid: nextReward > 0n,
        areasLeft: left.map(({ id, label, functions, examined }) => ({ id, label, functions, examined })),
        suggested: left[0]?.id ?? null,
      },
    };
  } catch (error) {
    if (error instanceof GithubUnavailableError) return GITHUB_UNAVAILABLE;
    throw error;
  }
}
