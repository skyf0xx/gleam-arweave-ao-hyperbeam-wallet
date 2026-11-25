#!/usr/bin/env node
// @ts-check
// Lists the security-surface paths a PR touches, writes them to the job
// summary, and fails unless the PR body ticks the surface box. Run by
// .github/workflows/surface.yml. Plain .mjs on bare Node: no install.
//
// Usage: node scripts/surface-check.mjs <base-sha>
// Env: PR_BODY, PR_AUTHOR, GITHUB_STEP_SUMMARY (all optional).

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { parseSurface } from "../security/surface.mjs";
import { isMain } from "./is-main.mjs";

/** @type {Record<number, string>} */
const TIER_NAMES = {
  1: "key material",
  2: "signing",
  3: "trust boundary",
  4: "what you see is what you sign",
  5: "other ways in",
};

/** The PR template's box, ticked. */
export const ACKNOWLEDGED = /^\s*[-*]\s*\[[xX]\]\s*Touches `?security\/surface\.txt`? paths/m;

/**
 * Each changed file on the surface, with its entry's tier.
 * @param {string[]} files
 * @param {{ tier: string, path: string }[]} entries
 * @returns {{ file: string, tier: number, path: string }[]}
 */
export function touchedSurface(files, entries) {
  return files.flatMap((file) => {
    const matches = entries.filter(({ path }) => (path.endsWith("/") ? file.startsWith(path) : file === path));
    if (matches.length === 0) return [];
    const tier = Math.min(...matches.map((entry) => Number(entry.tier)));
    const entry = /** @type {{ path: string }} */ (matches.find((match) => Number(match.tier) === tier));
    return [{ file, tier, path: entry.path }];
  });
}

/**
 * The verdict for one PR.
 * @param {{ file: string, tier: number }[]} touched
 * @param {{ body: string, author: string }} pr
 * @returns {{ ok: boolean, message: string }}
 */
export function verdict(touched, { body, author }) {
  if (touched.length === 0) return { ok: true, message: "No security-surface paths touched." };
  const highest = Math.min(...touched.map(({ tier }) => tier));
  const summary = `Touches ${touched.length} security-surface path(s); highest tier ${highest} (${TIER_NAMES[highest]}). The next release needs a fresh audit.`;
  // Dependabot can't tick a box; the release gate still sees its lockfile change.
  if (author === "dependabot[bot]" || ACKNOWLEDGED.test(body)) return { ok: true, message: summary };
  return {
    ok: false,
    message: `${summary} Tick "Touches security/surface.txt paths" in the PR description to acknowledge it.`,
  };
}

function main() {
  const base = process.argv[2];
  if (!base) throw new Error("usage: surface-check.mjs <base-sha>");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const entries = parseSurface(readFileSync(new URL("../security/surface.txt", import.meta.url), "utf8"));
  const touched = touchedSurface(files, entries);
  const result = verdict(touched, { body: process.env.PR_BODY ?? "", author: process.env.PR_AUTHOR ?? "" });

  const table = touched.map(({ file, tier, path }) => `| ${tier} | \`${file}\` | \`${path}\` |`);
  const report = [
    "## Security surface",
    "",
    result.message,
    ...(touched.length > 0 ? ["", "| tier | file | surface entry |", "| --- | --- | --- |", ...table] : []),
    "",
  ].join("\n");
  process.stdout.write(`${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (!result.ok) {
    process.stderr.write(`::error::${result.message}\n`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
