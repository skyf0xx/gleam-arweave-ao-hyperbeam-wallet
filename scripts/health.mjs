#!/usr/bin/env node
// @ts-check
// The pre-release code-health report (`pnpm health`). The gates that run
// on every commit (deps:check's no-circular, eslint's max-lines ratchet)
// stop new debt; this lists the debt already there, for the release to
// clear or log in todo.md:
// - knip: unused files, exports and dependencies;
// - jscpd: copied blocks;
// - the files still over the size limit, largest first, from the caps
//   in scripts/file-size-caps.mjs.
// A report, not a gate: every section runs and it exits 0 unless a tool
// itself fails to run.

import { spawnSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { FILE_SIZE_CAPS, MAX_LINES } from "./file-size-caps.mjs";

/** @param {string} title @param {string[]} command @returns {number} */
function section(title, command) {
  console.log(`\n== ${title}\n`);
  const result = spawnSync("pnpm", ["exec", ...command], { stdio: "inherit" });
  if (result.error || result.status === null) {
    console.error(`${command[0]} did not run: ${result.error?.message ?? result.signal}`);
    process.exit(2);
  }
  return result.status;
}

// knip exits 1 when it finds something.
const knipClean = section("Unused files, exports and dependencies (knip)", ["knip"]) === 0;
section("Copied blocks (jscpd)", ["jscpd"]);

console.log(`\n== Files over ${MAX_LINES} code lines (caps in scripts/file-size-caps.mjs)\n`);
const capped = Object.entries(FILE_SIZE_CAPS).sort(([, a], [, b]) => b - a);
for (const [file, cap] of capped) console.log(`${String(cap).padStart(6)}  ${file}`);
if (capped.length === 0) console.log("None.");

console.log(`\nknip: ${knipClean ? "clean" : "findings above"} · capped files: ${capped.length}`);
