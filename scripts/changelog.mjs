#!/usr/bin/env node
// @ts-check
// Reads one release's section from CHANGELOG.md, so a release can't be
// bumped, tagged or published without notes a user can read.
//
//   node scripts/changelog.mjs <version>    prints the section for v<version>
//
// Plain .mjs with JSDoc so it runs on bare Node with no install, as the
// release workflow calls it before any dependency is installed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { isMain } from "./is-main.mjs";

export const CHANGELOG_FILE = "CHANGELOG.md";

/**
 * The body of the `## v<version>` section, up to the next `## ` heading,
 * trimmed. Null when the section is missing or holds nothing but
 * sub-headings, so an empty stub can't pass for notes.
 * @param {string} text
 * @param {string} version
 * @returns {string | null}
 */
export function changelogSection(text, version) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const heading = `## v${version}`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const body = lines.slice(start + 1, next === -1 ? undefined : next).join("\n").trim();
  const hasContent = body.split("\n").some((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  return hasContent ? body : null;
}

/**
 * @param {string} root
 * @param {string} version
 * @returns {string}
 * @throws {Error} when CHANGELOG.md is unreadable or has no notes for the version
 */
export function readChangelogSection(root, version) {
  const section = changelogSection(readFileSync(join(root, CHANGELOG_FILE), "utf8"), version);
  if (section === null) throw new Error(`${CHANGELOG_FILE} has no notes for v${version}: add a "## v${version} (<date>)" section`);
  return section;
}

if (isMain(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    process.stderr.write("usage: node scripts/changelog.mjs <version>\n");
    process.exit(2);
  }
  try {
    process.stdout.write(`${readChangelogSection(process.cwd(), version)}\n`);
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exit(1);
  }
}
