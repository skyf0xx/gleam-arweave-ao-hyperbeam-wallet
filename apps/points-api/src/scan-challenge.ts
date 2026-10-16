import { randomBytes } from "node:crypto";
import { CHALLENGE_SIZE, pickChallenge, type ChallengeFunction } from "@gleam/core/src/scan/index.ts";
import type { Queryable } from "./db";
import { GithubUnavailableError, type GithubClient } from "./github";
import { GITHUB_UNAVAILABLE, NO_RELEASE, failure, type ScanFailure } from "./scan-errors";

export const CHALLENGE_TTL_MS = 24 * 3_600_000;
/** Unused challenges are kept a day past expiry, then dropped when the next one is issued. */
const PURGE_AFTER_MS = 24 * 3_600_000;

export interface IssuedChallenge {
  challenge: string;
  release: string;
  commit: string;
  functions: ChallengeFunction[];
  expiresAt: string;
}

export async function issueChallenge(
  db: Queryable,
  github: GithubClient,
  now: Date,
): Promise<{ ok: true; challenge: IssuedChallenge } | ScanFailure> {
  try {
    const latest = await github.latestRelease();
    if (!latest) return NO_RELEASE;
    const { functions: pool } = await github.filesAt(latest.commit);
    if (pool.length < CHALLENGE_SIZE) {
      return failure(
        503,
        "challenge_unavailable",
        "$",
        `v${latest.release} has fewer than ${CHALLENGE_SIZE} security functions to ask about; tell the maintainers, since scans can't start until it does.`,
      );
    }

    const picked = await pickChallenge(pool, randomBytes(32));
    const id = randomBytes(24).toString("base64url");
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    await db.query(
      "DELETE FROM challenges WHERE expires_at < $1 AND used_by_attestation IS NULL AND NOT EXISTS (SELECT 1 FROM attestations a WHERE a.challenge_id = challenges.id)",
      [new Date(now.getTime() - PURGE_AFTER_MS)],
    );
    await db.query(
      "INSERT INTO challenges (id, release, commit, functions, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, latest.release, latest.commit, JSON.stringify(picked), now, expiresAt],
    );
    return {
      ok: true,
      challenge: { challenge: id, release: latest.release, commit: latest.commit, functions: picked, expiresAt: expiresAt.toISOString() },
    };
  } catch (error) {
    if (error instanceof GithubUnavailableError) return GITHUB_UNAVAILABLE;
    throw error;
  }
}
