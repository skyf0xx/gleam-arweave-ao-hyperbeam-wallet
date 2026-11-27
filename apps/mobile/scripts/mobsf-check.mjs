#!/usr/bin/env node
// @ts-check
// Fails a release when MobSF reports a high or warning finding that isn't in
// apps/mobile/mobsf-baseline.json, where each accepted finding has its reason.
//
//   node apps/mobile/scripts/mobsf-check.mjs <android|ios> <scorecard.json>
//
// The scorecard is MobSF's /api/v1/scorecard response (mobsf-scan.sh).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";

const GATED = /** @type {const} */ (["high", "warning"]);

/**
 * @typedef {{ severity: string, title: string }} Finding
 * @param {Record<string, unknown>} scorecard
 * @returns {Finding[]}
 */
export function gatedFindings(scorecard) {
  return GATED.flatMap((severity) => {
    const rows = scorecard[severity];
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({ severity, title: String(row?.title ?? "") }));
  });
}

/**
 * @param {Finding[]} findings
 * @param {Finding[]} baseline
 */
export function compareWithBaseline(findings, baseline) {
  const key = (/** @type {Finding} */ f) => `${f.severity}\u0000${f.title}`;
  const accepted = new Set(baseline.map(key));
  const found = new Set(findings.map(key));
  return {
    added: findings.filter((f) => !accepted.has(key(f))),
    gone: baseline.filter((f) => !found.has(key(f))),
  };
}

function main() {
  const [platform, scorecardPath] = process.argv.slice(2);
  if ((platform !== "android" && platform !== "ios") || !scorecardPath) {
    console.error("usage: mobsf-check.mjs <android|ios> <scorecard.json>");
    process.exit(2);
  }
  const baselinePath = join(dirname(fileURLToPath(import.meta.url)), "../mobsf-baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"))[platform] ?? [];
  const scorecard = JSON.parse(readFileSync(scorecardPath, "utf8"));
  const { added, gone } = compareWithBaseline(gatedFindings(scorecard), baseline);
  for (const f of gone) console.log(`no longer reported, remove from the baseline: [${f.severity}] ${f.title}`);
  if (added.length > 0) {
    for (const f of added) console.error(`FAIL new MobSF finding: [${f.severity}] ${f.title}`);
    console.error(`Fix it, or add it to apps/mobile/mobsf-baseline.json with the reason it's safe.`);
    process.exit(1);
  }
  console.log(`OK MobSF ${platform}: score ${scorecard.security_score}, no findings outside the baseline`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
