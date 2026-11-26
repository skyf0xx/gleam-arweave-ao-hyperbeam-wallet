// @ts-check
// Writes the release version and the OpenSSF Scorecard score into the
// README's badges as fixed text. A live shields badge has to fetch its value
// first, and on a cold cache that outlasts GitHub's image proxy, which then
// shows a broken image. release:all runs this in the bump PR.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const README = "README.md";
const SCORECARD_API = "https://api.securityscorecards.dev/projects/github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet";

const RELEASE_BADGE = /\[!\[Release\]\([^)]*\)\]/g;
const SCORECARD_BADGE = /\[!\[OpenSSF Scorecard\]\([^)]*\)\]/g;

/** @param {number} score */
function scoreColor(score) {
  if (score >= 8) return "brightgreen";
  if (score >= 5) return "yellow";
  if (score >= 2) return "orange";
  return "red";
}

/**
 * Replaces the one badge `re` matches, so a renamed or duplicated badge
 * fails loudly instead of going stale.
 * @param {string} text @param {RegExp} re @param {string} badge @param {string} label
 */
function replaceOne(text, re, badge, label) {
  const count = [...text.matchAll(re)].length;
  if (count !== 1) throw new Error(`${README}: expected one ${label} badge, found ${count}`);
  return text.replace(re, badge);
}

/**
 * @param {string} text the README
 * @param {string} version e.g. "1.55.0"
 * @param {number | null} score the Scorecard score, or null to leave that badge as it is
 */
export function readmeWithBadges(text, version, score) {
  let out = replaceOne(text, RELEASE_BADGE, `[![Release](https://img.shields.io/badge/release-v${version}-blue)]`, "Release");
  if (score !== null) {
    const value = score.toFixed(1);
    out = replaceOne(
      out,
      SCORECARD_BADGE,
      `[![OpenSSF Scorecard](https://img.shields.io/badge/openssf_scorecard-${value}-${scoreColor(score)})]`,
      "OpenSSF Scorecard",
    );
  }
  return out;
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
 * Rewrites the README's badges for `version` and returns the files it changed.
 * @param {string} root @param {string} version @param {number | null} score
 */
export function writeReadmeBadges(root, version, score) {
  const path = join(root, README);
  const before = readFileSync(path, "utf8");
  const after = readmeWithBadges(before, version, score);
  if (after === before) return [];
  writeFileSync(path, after);
  return [README];
}
