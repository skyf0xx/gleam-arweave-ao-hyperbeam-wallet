import {
  addressFromOwner,
  buildAttestMessage,
  verifyPointsProof,
} from "@gleam/core/src/points/index.ts";
import {
  attestationId,
  checkAnswers,
  isScanAreaId,
  parseAttestation,
  roundReward,
  scanArea,
  scanRewardOf,
  type ChallengeFunction,
  type ParsedAttestation,
  type ScanAreaId,
  type ScanIssue,
} from "@gleam/core/src/scan/index.ts";
import { z } from "zod";
import { queryNumber, type Db, type Queryable } from "../db";
import { type GithubClient, type ReleaseFunction } from "./github";
import { owner, walletSigned } from "../request-fields";
import { areaSummaries, areasLeft, walletAreas, type AreaSummary } from "./areas";
import {
  withGithub,
  NO_RELEASE,
  failure,
  failureFromIssues,
  type ScanErrorCode,
  type ScanFailure,
  type ServerIssue,
} from "./errors";
import { paidPlaces } from "./places";
import { AttestationListCache, type UnpaidReason } from "./attestation-listing";
import { LIVENESS_WINDOW_MS } from "../points/snapshot";

// JSON has no undefined, so this only refuses a body without the key.
const attestation = z.unknown().refine((value) => value !== undefined);

export const checkRequest = z.object({
  attestation,
  /** The wallet that will sign. With it the dry run also reports `already_attested`, which is wallet-specific. */
  address: owner.optional(),
});
export type CheckRequest = z.infer<typeof checkRequest>;

export const submitRequest = walletSigned.extend({ attestation });
export type SubmitRequest = z.infer<typeof submitRequest>;

export interface CheckResult {
  attestationId: string;
  /** What the wallet signs. */
  message: string;
  paidPlacesLeft: number;
  /** Paid scans the release has taken; the places it opened are this plus `paidPlacesLeft`. */
  paidScans: number;
  /** The area the challenge was drawn from. */
  area: ScanAreaId;
}

export interface SubmitResult {
  attestationId: string;
  /** Atomic points credited now; "0" once the paid places are taken. */
  points: string;
  paid: boolean;
  /** Null when `paid`, and for a scan recorded before the reason was kept. */
  unpaidReason: UnpaidReason | null;
  paidPlacesLeft: number;
  /** Paid scans the release has taken, this one included. */
  paidScans: number;
  /** Null only when retrying a scan recorded before areas. */
  area: ScanAreaId | null;
  /** 1 for the wallet's first scan of the release; null only when retrying a scan recorded before rounds. */
  round: number | null;
}

interface ChallengeRow {
  release: string;
  commit: string;
  functions: ChallengeFunction[];
  expires_at: Date;
  used_by_attestation: string | null;
  area: string | null;
}

interface Checked {
  ok: true;
  functions: readonly ReleaseFunction[];
  area: ScanAreaId;
}

/**
 * The checks that don't need the signer (SCANS.md checks 2 and 3), shared
 * by the dry run and the real submission so an agent sees the same issues
 * before the user is asked to sign. It collects every issue it can.
 */
async function checkAgainstRelease(
  db: Queryable,
  github: GithubClient,
  attestation: ParsedAttestation,
  now: Date,
): Promise<Checked | ScanFailure> {
  const latest = await github.latestRelease();
  if (!latest) return NO_RELEASE;

  const issues: ServerIssue[] = [];
  const add = (code: ScanErrorCode, path: string, message: string) => issues.push({ code, path, message });
  const restart = "run `pnpm scan start` for a new one";
  if (attestation.release !== latest.release) {
    add(
      "release_not_latest",
      "release",
      `v${attestation.release} isn't the latest release (v${latest.release} is); check out v${latest.release} and run \`pnpm scan start\`.`,
    );
  } else if (attestation.commit !== latest.commit) {
    add(
      "commit_mismatch",
      "commit",
      `commit ${attestation.commit} isn't the commit of tag v${latest.release} (${latest.commit}); check out the tag and run \`pnpm scan start\` again.`,
    );
  }

  const { rows } = await db.query<ChallengeRow>(
    "SELECT release, commit, functions, expires_at, used_by_attestation, area FROM challenges WHERE id = $1",
    [attestation.challenge],
  );
  const challenge = rows[0];
  if (!challenge) {
    add("challenge_unknown", "challenge", `This challenge id is unknown; ${restart}.`);
  } else {
    if (challenge.expires_at.getTime() <= now.getTime()) add("challenge_expired", "challenge", `This challenge expired; ${restart}.`);
    else if (!isScanAreaId(challenge.area)) add("challenge_expired", "challenge", `This challenge was issued before scan areas; ${restart}.`);
    if (challenge.used_by_attestation !== null) add("challenge_used", "challenge", `This challenge was already used; ${restart}.`);
    if (challenge.release !== attestation.release) {
      add("challenge_wrong_release", "challenge", `This challenge was issued for v${challenge.release}, not v${attestation.release}; ${restart}.`);
    } else if (challenge.commit !== latest.commit) {
      add(
        "challenge_wrong_commit",
        "challenge",
        `This challenge was issued for commit ${challenge.commit}, but tag v${latest.release} now points at ${latest.commit}; run \`pnpm scan start\` again.`,
      );
    }
  }

  if (issues.length > 0 || !challenge || !isScanAreaId(challenge.area)) return failureFromIssues(issues);

  const { files, functions } = await github.filesAt(latest.commit);
  const answerIssues = checkAnswers(attestation.answers, challenge.functions, files);
  if (answerIssues.length > 0) {
    return { ok: false, status: 422, code: "answers_failed", error: answerIssues[0]!.message, issues: answerIssues };
  }
  return { ok: true, functions, area: challenge.area };
}

function invalidAttestation(issues: ScanIssue[]): ScanFailure {
  return { ok: false, status: 400, code: "invalid_attestation", error: issues[0]!.message, issues };
}

/** Everything `POST /attestations` checks except the signature, wallet liveness and registration; the one-per-area rule only when the request names the wallet. */
export async function checkAttestation(
  db: Queryable,
  github: GithubClient,
  request: CheckRequest,
  now: Date,
): Promise<{ ok: true; result: CheckResult } | ScanFailure> {
  const parsed = parseAttestation(request.attestation);
  if (!parsed.ok) return invalidAttestation(parsed.issues);
  return withGithub(async () => {
    const checked = await checkAgainstRelease(db, github, parsed.attestation, now);
    if (!checked.ok) return checked;
    if (request.address !== undefined) {
      const refused = await refuseScannedArea(db, request.address, parsed.attestation.release, checked);
      if (refused) return refused;
    }
    const id = await attestationId(parsed.attestation);
    const places = await paidPlaces(db, github, parsed.attestation.release);
    return {
      ok: true,
      result: {
        attestationId: id,
        message: buildAttestMessage(parsed.attestation.release, id),
        paidPlacesLeft: places.left,
        paidScans: places.taken,
        area: checked.area,
      },
    };
  });
}

/**
 * Accepts a signed attestation and credits its points, in the order
 * SCANS.md lists the checks. Everything that changes state happens in one
 * transaction under a per-release lock, so two scans can't both take the
 * last paid place or the same round, and a challenge or a wallet's scan of
 * an area can't be used twice.
 */
export async function submitAttestation(
  db: Db,
  github: GithubClient,
  request: SubmitRequest,
  now: Date,
  listings: AttestationListCache,
): Promise<{ ok: true; result: SubmitResult } | ScanFailure> {
  const parsed = parseAttestation(request.attestation);
  if (!parsed.ok) return invalidAttestation(parsed.issues);
  const attestation = parsed.attestation;
  const id = await attestationId(attestation);

  // 1. Signature, then wallet.
  const expected = buildAttestMessage(attestation.release, id);
  if (request.message !== expected) {
    return failure(
      400,
      "message_mismatch",
      "message",
      "The signed message isn't for this attestation; sign again from the link `pnpm scan finish` printed.",
    );
  }
  if (!(await verifyPointsProof(request.proof, request.owner, request.message, request.signature))) {
    return failure(401, "invalid_signature", "signature", "The wallet signature is invalid; sign again with the wallet that owns these points.");
  }
  const address = await addressFromOwner(request.owner);

  const wallet = await db.query<{ live: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM wallet_devices wd JOIN devices d ON d.id = wd.device_id
                    WHERE wd.address = w.address AND d.last_heartbeat_at >= $2) AS live
       FROM wallets w WHERE w.address = $1`,
    [address, new Date(now.getTime() - LIVENESS_WINDOW_MS)],
  );
  if (!wallet.rows[0]) return notRegistered();
  if (!wallet.rows[0].live) {
    return failure(
      403,
      "wallet_not_live",
      "owner",
      "This wallet's extension hasn't checked in during the last 3 days; open Gleam so it can, then sign again.",
    );
  }

  // A retry after a lost response gets the original answer back.
  const earlier = await db.query<{ paid: boolean; unpaid_reason: UnpaidReason | null; points: string; area: string | null; round: number | null }>(
    `SELECT a.paid, a.unpaid_reason, a.area, a.round,
            coalesce((SELECT sum(amount_atomic) FROM scan_points WHERE attestation_id = a.id AND kind = 'scan'), 0)::text AS points
       FROM attestations a WHERE a.id = $1 AND a.address = $2`,
    [id, address],
  );
  if (earlier.rows[0]) {
    const { paid, points, unpaid_reason: unpaidReason, area, round } = earlier.rows[0];
    const places = await paidPlaces(db, github, attestation.release);
    return {
      ok: true,
      result: {
        attestationId: id,
        points,
        paid,
        unpaidReason,
        paidPlacesLeft: places.left,
        paidScans: places.taken,
        area: isScanAreaId(area) ? area : null,
        round,
      },
    };
  }

  // 2 and 3. Release, commit, challenge and answers.
  const checked = await withGithub(() => checkAgainstRelease(db, github, attestation, now));
  if (!checked.ok) return checked;

  const outcome = await db.transaction(async (tx): Promise<{ ok: true; result: SubmitResult } | ScanFailure> => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`attest:${attestation.release}`]);
    // Leave deletes the wallet under this row lock's conflict, so the points below can't point at a gone wallet.
    const held = await tx.query("SELECT 1 FROM wallets WHERE address = $1 FOR SHARE", [address]);
    if (held.rows.length === 0) return notRegistered();

    const challenge = await tx.query<{ used_by_attestation: string | null }>(
      "SELECT used_by_attestation FROM challenges WHERE id = $1 FOR UPDATE",
      [attestation.challenge],
    );
    if (challenge.rows[0]?.used_by_attestation) {
      return failure(409, "challenge_used", "challenge", "This challenge was already used; run `pnpm scan start` for a new one.");
    }

    // 4. One scan per wallet per area of a release.
    const refused = await refuseScannedArea(tx, address, attestation.release, checked);
    if (refused) return refused;

    // 5. Paid places, shared by every round. A scan past them is still
    // recorded. A scan that earns nothing (no snapshot day yet) doesn't use
    // one up. Each further round pays ROUND_STEP_PERCENT more of the place.
    const round = (await walletRoundsDone(tx, address, attestation.release)) + 1;
    const { left, taken } = await paidPlaces(tx, github, attestation.release);
    const points = left > 0 ? roundReward(await scanReward(tx, now), round) : 0n;
    const paid = points > 0n;
    const unpaidReason: UnpaidReason | null = paid ? null : left > 0 ? "no_snapshot" : "places_taken";

    await tx.query(
      `INSERT INTO attestations (id, release, commit, challenge_id, address, owner, signature, proof, message, body, paid, created_at, function_total, unpaid_reason, area, round)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id, attestation.release, attestation.commit, attestation.challenge, address, request.owner, request.signature, request.proof,
        request.message, JSON.stringify(attestation), paid, now, checked.functions.length, unpaidReason, checked.area, round,
      ],
    );
    await tx.query("UPDATE challenges SET used_by_attestation = $2 WHERE id = $1", [attestation.challenge, id]);
    const answered = attestation.answers.flatMap(({ file, symbol }) =>
      checked.functions.filter((fn) => fn.file === file && fn.symbol === symbol),
    );
    await tx.query(
      `INSERT INTO examined_functions (attestation_id, file, symbol, fingerprint)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[]) ON CONFLICT DO NOTHING`,
      [id, answered.map((fn) => fn.file), answered.map((fn) => fn.symbol), answered.map((fn) => fn.fingerprint)],
    );
    if (points > 0n) {
      await tx.query(
        "INSERT INTO scan_points (address, attestation_id, kind, amount_atomic, created_at) VALUES ($1, $2, 'scan', $3, $4)",
        [address, id, points.toString(), now],
      );
    }
    return {
      ok: true,
      result: {
        attestationId: id,
        points: points.toString(),
        paid,
        unpaidReason,
        paidPlacesLeft: paid ? left - 1 : left,
        paidScans: paid ? taken + 1 : taken,
        area: checked.area,
        round,
      },
    };
  });
  if (outcome.ok) listings.clear();
  return outcome;
}

/** The wallet's non-voided scans of the release; the next one is this plus one. */
export async function walletRoundsDone(db: Queryable, address: string, release: string): Promise<number> {
  return queryNumber(
    db,
    "SELECT count(*)::text AS n FROM attestations WHERE address = $1 AND release = $2 AND voided_at IS NULL",
    [address, release],
    "n",
  );
}

/** `already_attested` when the wallet has scanned the challenge's area, naming the least-covered area it can scan instead. */
async function refuseScannedArea(db: Queryable, address: string, release: string, checked: Checked): Promise<ScanFailure | null> {
  const scanned = await walletAreas(db, address, release);
  if (!scanned.has(checked.area)) return null;
  const next = areasLeft(await areaSummaries(db, release, checked.functions), scanned)[0];
  return alreadyAttested(release, checked.area, next);
}

function alreadyAttested(release: string, area: ScanAreaId, next: AreaSummary | undefined): ScanFailure {
  const message = next
    ? `This wallet already scanned the ${scanArea(area).label} area of v${release}; run \`pnpm scan start --area ${next.id}\` to scan ${next.label} instead.`
    : `This wallet has scanned every area of v${release}; wait for the next release.`;
  return failure(409, "already_attested", "owner", message);
}

function notRegistered(): ScanFailure {
  return failure(
    403,
    "wallet_not_registered",
    "owner",
    "This wallet isn't registered for Gleam Points; register it in Gleam → Points, then sign again.",
  );
}

export interface ScanRewardBasis {
  /** The latest completed snapshot day before today's (UTC), or null before there is one. */
  day: string | null;
  /** Total holding points issued on `day`; 0 when it is null. */
  issuedAtomic: bigint;
  /** What a paid scan earns if submitted now: 0.1% of `issuedAtomic`, truncated. */
  rewardAtomic: bigint;
}

/** The snapshot day a scan submitted at `now` is paid from, and what it pays. */
export async function scanRewardBasis(db: Queryable, now: Date): Promise<ScanRewardBasis> {
  const { rows } = await db.query<{ day: string | null; total: string }>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(sum(p.holding_atomic), 0)::text AS total
       FROM (SELECT max(day) AS day FROM snapshot_runs WHERE day < $1::date) d
       LEFT JOIN points p ON p.day = d.day
      GROUP BY d.day`,
    [now.toISOString().slice(0, 10)],
  );
  const issuedAtomic = BigInt(rows[0]!.total);
  return { day: rows[0]!.day, issuedAtomic, rewardAtomic: scanRewardOf(issuedAtomic) };
}

/** What a paid place earns before its round's step. */
export async function scanReward(tx: Queryable, now: Date): Promise<bigint> {
  return (await scanRewardBasis(tx, now)).rewardAtomic;
}
