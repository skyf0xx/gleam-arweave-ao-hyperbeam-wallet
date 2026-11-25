import {
  addressFromOwner,
  buildAttestMessage,
  verifyPointsProof,
  type PointsProofKind,
} from "@gleam/core/src/points/index.ts";
import {
  SCAN_AREAS,
  attestationId,
  checkAnswers,
  isRelease,
  isScanAreaId,
  parseAttestation,
  roundReward,
  scanArea,
  scanRewardOf,
  type AttestationAnswer,
  type ChallengeFunction,
  type ParsedAttestation,
  type ScanAreaId,
  type ScanIssue,
} from "@gleam/core/src/scan/index.ts";
import { z } from "zod";
import type { Db, Queryable } from "../db";
import { GithubUnavailableError, type GithubClient, type ReleaseFunction } from "./github";
import { owner, walletSigned } from "../request-fields";
import { answeredFunctions, areaSummaries, areasLeft, examinedFunctions, functionKey, walletAreas, type AreaSummary } from "./areas";
import {
  GITHUB_UNAVAILABLE,
  NO_RELEASE,
  failure,
  failureFromIssues,
  type ScanErrorCode,
  type ScanFailure,
  type ServerIssue,
} from "./errors";
import { paidPlaces } from "./places";
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

/** Why a scan earned nothing: its release's paid places were gone, or no daily snapshot exists yet to base points on. */
export type UnpaidReason = "places_taken" | "no_snapshot";

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

async function attestationTotal(db: Queryable, release: string): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    "SELECT count(*)::text AS total FROM attestations WHERE release = $1 AND voided_at IS NULL",
    [release],
  );
  return Number(rows[0]!.total);
}

async function distinctModels(db: Queryable, release: string): Promise<string[]> {
  const { rows } = await db.query<{ model: string }>(
    `SELECT DISTINCT body->>'model' AS model FROM attestations
      WHERE release = $1 AND voided_at IS NULL ORDER BY model LIMIT ${MAX_MODEL_LABELS}`,
    [release],
  );
  return rows.map((row) => row.model);
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
  try {
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
  } catch (error) {
    if (error instanceof GithubUnavailableError) return GITHUB_UNAVAILABLE;
    throw error;
  }
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
  let checked: Checked;
  try {
    const outcome = await checkAgainstRelease(db, github, attestation, now);
    if (!outcome.ok) return outcome;
    checked = outcome;
  } catch (error) {
    if (error instanceof GithubUnavailableError) return GITHUB_UNAVAILABLE;
    throw error;
  }

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
  const { rows } = await db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM attestations WHERE address = $1 AND release = $2 AND voided_at IS NULL",
    [address, release],
  );
  return Number(rows[0]!.n);
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

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** Labels are at most 64 characters, so this bounds the field at about 64 KB however many distinct ones are submitted. */
const MAX_MODEL_LABELS = 1000;
const LISTING_TTL_MS = 60_000;
const MAX_CACHED_LISTINGS = 200;

/** What a release's listing says about the release as a whole, whatever page is asked for. */
interface ReleaseSummary {
  commit: string;
  total: number;
  paidPlacesLeft: number;
  paidScans: number;
  models: string[];
  /** Null until a first page (no cursor) has computed it. */
  coverage: AttestationListing["coverage"] | null;
}

/**
 * Pages kept for a minute per (release, cursor, limit), and each release's
 * summary kept for a minute per release. A new attestation clears both; a
 * void made by the `scan-void` script, which runs in another process,
 * shows up when the minute ends. The oldest entry goes when one is full.
 */
export class AttestationListCache {
  private readonly pages = new Map<string, { listing: AttestationListing; expiresAt: number }>();
  private readonly summaries = new Map<string, { summary: ReleaseSummary; expiresAt: number }>();

  constructor(private readonly now: () => number) {}

  page(key: string): AttestationListing | undefined {
    const hit = this.pages.get(key);
    return hit && this.now() < hit.expiresAt ? hit.listing : undefined;
  }

  setPage(key: string, listing: AttestationListing): void {
    remember(this.pages, key, { listing, expiresAt: this.now() + LISTING_TTL_MS });
  }

  summary(release: string): ReleaseSummary | undefined {
    const hit = this.summaries.get(release);
    return hit && this.now() < hit.expiresAt ? hit.summary : undefined;
  }

  setSummary(release: string, summary: ReleaseSummary): void {
    remember(this.summaries, release, { summary, expiresAt: this.now() + LISTING_TTL_MS });
  }

  clear(): void {
    this.pages.clear();
    this.summaries.clear();
  }
}

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_CACHED_LISTINGS) map.delete(map.keys().next().value!);
}

export interface ListQuery {
  /** Null for the latest release. */
  release: string | null;
  cursor: { createdAt: string; id: string } | null;
  limit: number;
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([0-9a-f]{64})$/;

export function parseListQuery(query: { release?: string; cursor?: string; limit?: string }): ListQuery | ScanFailure {
  const bad = (path: string, message: string) => failure(400, "malformed_request", path, message);
  if (query.release !== undefined && !isRelease(query.release)) {
    return bad("release", "release must be a version like 1.4.0 (no leading v).");
  }
  let limit = DEFAULT_PAGE_SIZE;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!/^\d+$/.test(query.limit) || limit < 1) return bad("limit", `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
    limit = Math.min(limit, MAX_PAGE_SIZE);
  }
  let cursor: ListQuery["cursor"] = null;
  if (query.cursor !== undefined) {
    const match = CURSOR.exec(Buffer.from(query.cursor, "base64url").toString("utf8"));
    const valid = match && !Number.isNaN(Date.parse(match[1]!)) && new Date(match[1]!).toISOString() === match[1];
    if (!match || !valid) return bad("cursor", "cursor isn't one this server issued; use the nextCursor from the previous page.");
    cursor = { createdAt: match[1]!, id: match[2]! };
  }
  return { release: query.release ?? null, cursor, limit };
}

export interface AttestationListing {
  release: string;
  commit: string;
  /** Non-voided attestations of the release, whatever page this is. */
  total: number;
  /** Over every attestation of the release, whatever page this is. */
  paidPlacesLeft: number;
  /** Paid scans the release has taken, whatever page this is; the places it opened are this plus `paidPlacesLeft`. */
  paidScans: number;
  /** The distinct model labels of the release's non-voided attestations, whatever page this is, sorted. At most MAX_MODEL_LABELS. */
  models: string[];
  /**
   * Over every attestation of the release. Null on a page reached by cursor
   * when no first page has computed it in the last minute. `unexamined` is
   * null for a release that isn't the latest: its function list isn't
   * fetched from GitHub, so only the counts are known.
   */
  coverage: {
    examined: number;
    total: number;
    unexamined: { file: string; symbol: string }[] | null;
    /** In tier order; null when `unexamined` is. */
    byArea: { id: ScanAreaId; label: string; examined: number; total: number }[] | null;
  } | null;
  /** Newest first. */
  attestations: {
    id: string;
    model: string;
    result: string;
    report: string;
    answers: AttestationAnswer[];
    createdAt: string;
    paid: boolean;
    /** Null when `paid`, and for a scan recorded before the reason was kept. */
    unpaidReason: UnpaidReason | null;
    /** Null for a whole-surface scan recorded before areas. */
    area: ScanAreaId | null;
    /** Null for a scan recorded before rounds. */
    round: number | null;
    owner: string;
    signature: string;
    proof: PointsProofKind;
    message: string;
  }[];
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: string | null;
}

/**
 * Non-voided attestations of one release and its paid places, with no
 * coverage. A release with none is 0, whether or not it exists. GitHub is
 * read only once per release, to open the latest one's places.
 */
export async function countAttestations(
  db: Queryable,
  github: GithubClient,
  query: { release?: string },
): Promise<{ ok: true; release: string; total: number; paidPlacesLeft: number; paidScans: number } | ScanFailure> {
  if (query.release === undefined || !isRelease(query.release)) {
    return failure(400, "malformed_request", "release", "release must be a version like 1.4.0 (no leading v).");
  }
  try {
    const [total, places] = await Promise.all([attestationTotal(db, query.release), paidPlaces(db, github, query.release)]);
    return { ok: true, release: query.release, total, paidPlacesLeft: places.left, paidScans: places.taken };
  } catch (error) {
    if (error instanceof GithubUnavailableError) return GITHUB_UNAVAILABLE;
    throw error;
  }
}

/**
 * Everything needed to verify each attestation without trusting Gleam.
 * Voided ones are left out. Only the latest release and releases that
 * already have attestations are answered, so a caller can't make the server
 * ask GitHub about arbitrary versions.
 */
export async function listAttestations(
  db: Queryable,
  github: GithubClient,
  cache: AttestationListCache,
  query: ListQuery,
): Promise<{ ok: true; listing: AttestationListing } | ScanFailure> {
  const key = `${query.release ?? "latest"}|${query.cursor ? `${query.cursor.createdAt}_${query.cursor.id}` : ""}|${query.limit}`;
  const cached = cache.page(key);
  if (cached) return { ok: true, listing: cached };

  try {
    let release: string;
    let commit: string;
    let isLatest: boolean;
    let storedTotal: number | null = null;
    const stored =
      query.release === null
        ? undefined
        : (
            await db.query<{ commit: string; function_total: number | null }>(
              "SELECT commit, function_total FROM attestations WHERE release = $1 ORDER BY created_at, id LIMIT 1",
              [query.release],
            )
          ).rows[0];
    if (query.release !== null && stored) {
      release = query.release;
      commit = stored.commit;
      storedTotal = stored.function_total;
      // Whether it's the latest only decides how detailed coverage is, so GitHub being down isn't an error here.
      isLatest = (await github.latestRelease().catch(() => null))?.release === release;
    } else {
      const latest = await github.latestRelease();
      if (query.release === null && !latest) return NO_RELEASE;
      if (query.release !== null && latest?.release !== query.release) {
        return failure(
          404,
          "unknown_release",
          "release",
          `No scans exist for v${query.release} — scan it now to earn GLEAM`,
        );
      }
      ({ release, commit } = latest!);
      isLatest = true;
    }

    let summary = cache.summary(release);
    if (!summary || (summary.coverage === null && query.cursor === null)) {
      const places = await paidPlaces(db, github, release);
      summary = {
        commit,
        total: await attestationTotal(db, release),
        paidPlacesLeft: places.left,
        paidScans: places.taken,
        models: await distinctModels(db, release),
        coverage: query.cursor === null ? await coverageOf(db, github, { release, commit, isLatest, storedTotal }) : null,
      };
      cache.setSummary(release, summary);
    }

    const rows = (
      await db.query<{
        id: string;
        body: { model: string; result: string; report: string; answers: AttestationAnswer[] };
        created_at: Date;
        paid: boolean;
        unpaid_reason: UnpaidReason | null;
        area: string | null;
        round: number | null;
        owner: string;
        signature: string;
        proof: PointsProofKind;
        message: string;
      }>(
        `SELECT id, body, created_at, paid, unpaid_reason, area, round, owner, signature, proof, message FROM attestations
          WHERE release = $1 AND voided_at IS NULL
            AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3))
          ORDER BY created_at DESC, id DESC LIMIT $4`,
        [release, query.cursor?.createdAt ?? null, query.cursor?.id ?? "", query.limit + 1],
      )
    ).rows;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];

    const listing: AttestationListing = {
      release,
      commit,
      total: summary.total,
      paidPlacesLeft: summary.paidPlacesLeft,
      paidScans: summary.paidScans,
      models: summary.models,
      coverage: summary.coverage,
      attestations: page.map((row) => ({
        id: row.id,
        model: row.body.model,
        result: row.body.result,
        report: row.body.report,
        answers: row.body.answers,
        createdAt: row.created_at.toISOString(),
        paid: row.paid,
        unpaidReason: row.unpaid_reason,
        area: isScanAreaId(row.area) ? row.area : null,
        round: row.round,
        owner: row.owner,
        signature: row.signature,
        proof: row.proof,
        message: row.message,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(`${last.created_at.toISOString()}_${last.id}`).toString("base64url")
          : null,
    };
    cache.setPage(key, listing);
    return { ok: true, listing };
  } catch (error) {
    if (error instanceof GithubUnavailableError) return GITHUB_UNAVAILABLE;
    throw error;
  }
}

/**
 * The latest release's checking functions examined in their current text,
 * on it or an earlier release, read from GitHub (cached) to name the
 * unexamined ones. If GitHub is down, and for any other release, it counts
 * only the functions the release's own scans answered, out of the total
 * stored when its first attestation was accepted.
 */
async function coverageOf(
  db: Queryable,
  github: GithubClient,
  release: { release: string; commit: string; isLatest: boolean; storedTotal: number | null },
): Promise<NonNullable<AttestationListing["coverage"]>> {
  const seen = await answeredFunctions(db, release.release);
  const countsOnly = (total: number) => ({ examined: seen.size, total, unexamined: null, byArea: null });

  if (release.isLatest) {
    try {
      const { functions } = await github.filesAt(release.commit);
      const examined = await examinedFunctions(db, release.release, functions);
      const unexamined = functions.filter((fn) => !examined.has(functionKey(fn))).map(({ file, symbol }) => ({ file, symbol }));
      const byArea = SCAN_AREAS.map(({ id, label }) => {
        const own = functions.filter((fn) => fn.area === id);
        return { id, label, examined: own.filter((fn) => examined.has(functionKey(fn))).length, total: own.length };
      });
      return { examined: functions.length - unexamined.length, total: functions.length, unexamined, byArea };
    } catch (error) {
      if (!(error instanceof GithubUnavailableError) || release.storedTotal === null) throw error;
      return countsOnly(release.storedTotal);
    }
  }
  if (release.storedTotal !== null) return countsOnly(release.storedTotal);
  // A row written without a total: read the list once, then it's cached with the summary.
  return countsOnly((await github.filesAt(release.commit)).functions.length);
}
