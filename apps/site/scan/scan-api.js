// scan.html and review-results.html: the points API. Everything it sends is
// data: callers render it with textContent only.
import { COUNT, ID_PATTERN, POINTS_API, RELEASE_PATTERN, isAreaRow } from "./scan-lib.js";

/** GETs `path` from the points API. Settles with `{ ok: true, body }` or `{ ok: false, status, error }`; it never rejects. */
async function getJson(fetchImpl, path, signal, isValid) {
  try {
    const response = await fetchImpl(`${POINTS_API}${path}`, { signal });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = body && typeof body.error === "string" ? body.error : `The points server answered ${response.status}.`;
      return { ok: false, status: response.status, error };
    }
    if (!isValid(body)) return { ok: false, status: response.status, error: "The points server sent something this page can't read." };
    return { ok: true, body };
  } catch {
    return { ok: false, status: 0, error: "The points server couldn't be reached." };
  }
}

/**
 * Reads one page of `GET /attestations`. Settles with `{ ok: true, listing }`
 * or `{ ok: false, status, error }`; it never rejects.
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchImpl
 * @param {{ release?: string | null, cursor?: string | null, limit?: number, signal?: AbortSignal }} [options]
 */
export async function fetchListing(fetchImpl, { release = null, cursor = null, limit = 100, signal } = {}) {
  const params = new URLSearchParams();
  if (release) params.set("release", release);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  const result = await getJson(fetchImpl, `/attestations?${params}`, signal, isListing);
  return result.ok ? { ok: true, listing: result.body } : result;
}

const ATOMIC = /^\d{1,40}$/;

function isRewards(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    (body.day === null || typeof body.day === "string") &&
    ATOMIC.test(body.issuedAtomic) &&
    ATOMIC.test(body.scanRewardAtomic) &&
    ATOMIC.test(body.bountyPoolAtomic)
  );
}

/** The paid places a release opens, at least and at most; the same as `@gleam/core/scan`. */
export const MIN_PAID_SCANS_PER_RELEASE = 1;
export const MIN_PAID_SCANS_PER_MINOR_RELEASE = 50;
export const PAID_SCANS_PER_RELEASE = 100;

/** What the next scan earns, from a `GET /scan/rewards` body and a release's `paidPlacesLeft`. */
export function nextScanReward(rewards, paidPlacesLeft) {
  return paidPlacesLeft > 0 ? rewards.scanRewardAtomic : "0";
}

/** " of N", the paid places a listing's release opened; empty when the server doesn't say. */
export function placesOf(listing) {
  return Number.isInteger(listing.paidScans) ? ` of ${listing.paidScans + Math.max(0, listing.paidPlacesLeft)}` : "";
}

/**
 * Reads `GET /scan/rewards`: what a paid scan earns now and the bounty pool's
 * balance. Settles with `{ ok: true, rewards }` or `{ ok: false, … }`.
 */
export async function fetchRewards(fetchImpl, { signal } = {}) {
  const result = await getJson(fetchImpl, "/scan/rewards", signal, isRewards);
  return result.ok ? { ok: true, rewards: result.body } : result;
}

// SCANS.md § Findings: the share of the pool's balance an accepted finding takes.
export const BOUNTY_TIERS = [
  { severity: "Critical", percent: 50 },
  { severity: "High", percent: 25 },
  { severity: "Medium", percent: 10 },
];

/** Each tier with what it would pay from a pool of `poolAtomic` today, in atomic units (integer division, as the server pays). */
export function bountyTiers(poolAtomic) {
  const pool = typeof poolAtomic === "string" && ATOMIC.test(poolAtomic) ? BigInt(poolAtomic) : null;
  return BOUNTY_TIERS.map((tier) => ({
    ...tier,
    amountAtomic: pool === null ? null : ((pool * BigInt(tier.percent)) / 100n).toString(),
  }));
}

function isCount(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.release === "string" &&
    Number.isInteger(body.total) &&
    Number.isInteger(body.paidPlacesLeft)
  );
}

/**
 * Reads `GET /attestations/count`: how many reviews `release` has. Settles with
 * `{ ok: true, count }` or `{ ok: false, … }`.
 */
export async function fetchCount(fetchImpl, release, { signal } = {}) {
  const params = new URLSearchParams({ release });
  const result = await getJson(fetchImpl, `/attestations/count?${params}`, signal, isCount);
  return result.ok ? { ok: true, count: result.body } : result;
}

/** The results page for a release, optionally opened at one attestation. */
export function resultsHref(release, attestationId) {
  const base = release && RELEASE_PATTERN.test(release) ? `review-results.html?v=${release}` : "review-results.html";
  return attestationId && ID_PATTERN.test(attestationId) ? `${base}#${attestationId}` : base;
}

function isListing(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.release === "string" &&
    Number.isInteger(body.paidPlacesLeft) &&
    Array.isArray(body.attestations)
  );
}

function isAreas(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.release === "string" &&
    Array.isArray(body.areas) &&
    body.areas.every((row) => isAreaRow(row) && COUNT(row.functions) && COUNT(row.examined) && COUNT(row.scans))
  );
}

/**
 * Reads `GET /scan/areas`: how much of each area of the latest release has been
 * examined. Settles with `{ ok: true, areas }` or `{ ok: false, … }`.
 */
export async function fetchAreas(fetchImpl, { signal } = {}) {
  const result = await getJson(fetchImpl, "/scan/areas", signal, isAreas);
  return result.ok ? { ok: true, areas: result.body } : result;
}
