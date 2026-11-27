// @ts-check
// Writes the release and OpenSSF Scorecard badges as SVG files in the repo,
// which the README shows by relative path. GitHub serves those itself; a
// shields URL goes through GitHub's image proxy, which shows a broken image
// whenever shields is slow on a URL it hasn't cached, as each release's new
// URL is. release:all runs this in the bump PR.
import console from "node:console";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCORECARD_API = "https://api.securityscorecards.dev/projects/github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet";
export const RELEASE_BADGE = "docs/badges/release.svg";
export const SCORECARD_BADGE = "docs/badges/scorecard.svg";
const MAX_BADGE_BYTES = 16 * 1024;

/** @param {number} score */
function scoreColor(score) {
  if (score >= 8) return "brightgreen";
  if (score >= 5) return "yellow";
  if (score >= 2) return "orange";
  return "red";
}

/** @param {string} version e.g. "1.55.0" */
export function releaseBadgeUrl(version) {
  return `https://img.shields.io/badge/release-v${version}-blue`;
}

/** @param {number} score */
export function scorecardBadgeUrl(score) {
  return `https://img.shields.io/badge/openssf_scorecard-${score.toFixed(1)}-${scoreColor(score)}`;
}

/**
 * One badge's SVG. Throws unless the reply is a small SVG with no script,
 * since it is committed and shown on the repo page.
 * @param {string} url @param {typeof fetch} fetchImpl
 */
export async function fetchBadge(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: globalThis.AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const svg = await res.text();
  if (svg.length > MAX_BADGE_BYTES || !/^<svg[\s>]/.test(svg) || !svg.trimEnd().endsWith("</svg>") || /<script|<foreignObject/i.test(svg)) {
    throw new Error(`${url}: not a badge SVG`);
  }
  return svg;
}

/**
 * The repo's latest published Scorecard score, or null when the API can't
 * be read: a stale score is better than a failed release.
 * @param {typeof fetch} fetchImpl
 */
export async function fetchScorecardScore(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(SCORECARD_API, { signal: globalThis.AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = /** @type {unknown} */ (await res.json());
    const score = body && typeof body === "object" && "score" in body ? body.score : undefined;
    return typeof score === "number" && score >= 0 && score <= 10 ? score : null;
  } catch {
    return null;
  }
}

/**
 * Writes the release badge for `version` and, with a score, the Scorecard
 * badge, and returns the files it changed. A release badge it can't fetch
 * fails the bump, since a stale version misleads; a Scorecard badge it can't
 * fetch keeps the last one, as a stale score is better than a failed release.
 * @param {string} root @param {string} version @param {number | null} score
 * @param {typeof fetch} [fetchImpl]
 */
export async function writeReadmeBadges(root, version, score, fetchImpl = globalThis.fetch) {
  /** @type {[string, string][]} */
  const badges = [[RELEASE_BADGE, await fetchBadge(releaseBadgeUrl(version), fetchImpl)]];
  if (score !== null) {
    try {
      badges.push([SCORECARD_BADGE, await fetchBadge(scorecardBadgeUrl(score), fetchImpl)]);
    } catch (error) {
      console.warn(`Kept the last Scorecard badge: ${/** @type {Error} */ (error).message}`);
    }
  }
  return badges.flatMap(([file, svg]) => {
    const path = join(root, file);
    let before = null;
    try {
      before = readFileSync(path, "utf8");
    } catch {
      // A first write.
    }
    if (before === svg) return [];
    writeFileSync(path, svg);
    return [file];
  });
}
