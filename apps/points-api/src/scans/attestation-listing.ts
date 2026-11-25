import { type PointsProofKind } from "@gleam/core/src/points/index.ts";
import {
  SCAN_AREAS,
  isRelease,
  isScanAreaId,
  type AttestationAnswer,
  type ScanAreaId,
} from "@gleam/core/src/scan/index.ts";
import { z } from "zod";
import { queryNumber, type Queryable } from "../db";
import { GithubUnavailableError, type GithubClient } from "./github";
import { answeredFunctions, examinedFunctions, functionKey } from "./areas";
import { withGithub, NO_RELEASE, failure, type ScanFailure } from "./errors";
import { paidPlaces } from "./places";
import { keyedTtlCache } from "../ttl-cache";

/** Why a scan earned nothing: its release's paid places were gone, or no daily snapshot exists yet to base points on. */
export type UnpaidReason = "places_taken" | "no_snapshot";

async function attestationTotal(db: Queryable, release: string): Promise<number> {
  return queryNumber(db, "SELECT count(*)::text AS total FROM attestations WHERE release = $1 AND voided_at IS NULL", [release], "total");
}

async function distinctModels(db: Queryable, release: string): Promise<string[]> {
  const { rows } = await db.query<{ model: string }>(
    `SELECT DISTINCT body->>'model' AS model FROM attestations
      WHERE release = $1 AND voided_at IS NULL ORDER BY model LIMIT ${MAX_MODEL_LABELS}`,
    [release],
  );
  return rows.map((row) => row.model);
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
  private readonly pages: ReturnType<typeof keyedTtlCache<AttestationListing>>;
  private readonly summaries: ReturnType<typeof keyedTtlCache<ReleaseSummary>>;

  constructor(now: () => number) {
    this.pages = keyedTtlCache(LISTING_TTL_MS, now, MAX_CACHED_LISTINGS);
    this.summaries = keyedTtlCache(LISTING_TTL_MS, now, MAX_CACHED_LISTINGS);
  }

  page(key: string): AttestationListing | undefined {
    return this.pages.get(key);
  }

  setPage(key: string, listing: AttestationListing): void {
    this.pages.set(key, listing);
  }

  summary(release: string): ReleaseSummary | undefined {
    return this.summaries.get(release);
  }

  setSummary(release: string, summary: ReleaseSummary): void {
    this.summaries.set(release, summary);
  }

  clear(): void {
    this.pages.clear();
    this.summaries.clear();
  }
}

export interface ListQuery {
  /** Null for the latest release. */
  release: string | null;
  cursor: { createdAt: string; id: string } | null;
  limit: number;
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([0-9a-f]{64})$/;

const RELEASE_ERROR = "release must be a version like 1.4.0 (no leading v).";
const LIMIT_ERROR = `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`;
const CURSOR_ERROR = "cursor isn't one this server issued; use the nextCursor from the previous page.";

const releaseVersion = z.string({ error: RELEASE_ERROR }).refine(isRelease, { error: RELEASE_ERROR });

const pageLimit = z
  .string({ error: LIMIT_ERROR })
  .regex(/^\d+$/, { error: LIMIT_ERROR })
  .transform(Number)
  .refine((limit) => limit >= 1, { error: LIMIT_ERROR })
  .transform((limit) => Math.min(limit, MAX_PAGE_SIZE));

const pageCursor = z.string({ error: CURSOR_ERROR }).transform((cursor, ctx) => {
  const match = CURSOR.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  const valid = match && !Number.isNaN(Date.parse(match[1]!)) && new Date(match[1]!).toISOString() === match[1];
  if (!match || !valid) {
    ctx.addIssue({ code: "custom", message: CURSOR_ERROR });
    return z.NEVER;
  }
  return { createdAt: match[1]!, id: match[2]! };
});

export const listQuery = z
  .object({ release: releaseVersion.optional(), limit: pageLimit.optional(), cursor: pageCursor.optional() })
  .transform((query): ListQuery => ({ release: query.release ?? null, cursor: query.cursor ?? null, limit: query.limit ?? DEFAULT_PAGE_SIZE }));

export const countQuery = z.object({ release: releaseVersion });

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
  release: string,
): Promise<{ ok: true; release: string; total: number; paidPlacesLeft: number; paidScans: number } | ScanFailure> {
  return withGithub(async () => {
    const [total, places] = await Promise.all([attestationTotal(db, release), paidPlaces(db, github, release)]);
    return { ok: true, release, total, paidPlacesLeft: places.left, paidScans: places.taken };
  });
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

  return withGithub(async () => {
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
  });
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
