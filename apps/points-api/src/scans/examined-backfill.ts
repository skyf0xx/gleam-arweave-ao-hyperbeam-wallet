import type { Db } from "../db";
import { GithubUnavailableError, type GithubClient } from "./github";

export interface BackfillPlan {
  /** Fingerprint rows to write, one per answered function found at its attestation's commit. */
  rows: { attestationId: string; file: string; symbol: string; fingerprint: string }[];
  attestations: number;
  /** Commits whose surface couldn't be read, with why. */
  skipped: { commit: string; reason: string }[];
  /** Answers naming a function the commit's surface doesn't list. */
  unmatched: number;
}

/**
 * Fingerprints for attestations accepted before `examined_functions` existed:
 * each answer's function, hashed from its text at the attestation's commit,
 * so coverage on later releases counts it. Reads GitHub once per commit and
 * writes nothing.
 */
export async function planExaminedBackfill(db: Db, github: GithubClient): Promise<BackfillPlan> {
  const { rows } = await db.query<{ id: string; commit: string; answers: { file: string; symbol: string }[] | null }>(
    `SELECT a.id, a.commit, a.body->'answers' AS answers FROM attestations a
      WHERE NOT EXISTS (SELECT 1 FROM examined_functions e WHERE e.attestation_id = a.id)
      ORDER BY a.commit, a.id`,
  );
  const plan: BackfillPlan = { rows: [], attestations: 0, skipped: [], unmatched: 0 };
  const byCommit = new Map<string, typeof rows>();
  for (const row of rows) byCommit.set(row.commit, [...(byCommit.get(row.commit) ?? []), row]);
  for (const [commit, attestations] of byCommit) {
    let functions;
    try {
      ({ functions } = await github.filesAt(commit));
    } catch (error) {
      if (!(error instanceof GithubUnavailableError)) throw error;
      plan.skipped.push({ commit, reason: error.message });
      continue;
    }
    for (const attestation of attestations) {
      let found = 0;
      for (const answer of attestation.answers ?? []) {
        const fn = functions.find((candidate) => candidate.file === answer.file && candidate.symbol === answer.symbol);
        if (!fn) {
          plan.unmatched++;
          continue;
        }
        plan.rows.push({ attestationId: attestation.id, file: fn.file, symbol: fn.symbol, fingerprint: fn.fingerprint });
        found++;
      }
      if (found > 0) plan.attestations++;
    }
  }
  return plan;
}

/** Writes a plan's rows in one transaction; a row already there is left alone. */
export async function applyExaminedBackfill(db: Db, plan: BackfillPlan): Promise<number> {
  if (plan.rows.length === 0) return 0;
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ n: string }>(
      `WITH added AS (
         INSERT INTO examined_functions (attestation_id, file, symbol, fingerprint)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
         ON CONFLICT DO NOTHING RETURNING 1
       ) SELECT count(*)::text AS n FROM added`,
      [plan.rows.map((r) => r.attestationId), plan.rows.map((r) => r.file), plan.rows.map((r) => r.symbol), plan.rows.map((r) => r.fingerprint)],
    );
    return Number(rows[0]!.n);
  });
}
