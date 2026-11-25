import { parseArgs } from "node:util";
import { applyExaminedBackfill, planExaminedBackfill } from "../src/scans/examined-backfill";
import { createGithubClient } from "../src/scans/github";
import { confirmOrCancel } from "../src/scans/bounty";
import { askYesNo, runScript } from "./cli";

let yes = false;
await runScript(
  "Usage: scan-backfill [--yes]",
  (argv) => {
    yes = parseArgs({ args: argv, options: { yes: { type: "boolean" } }, strict: true }).values.yes ?? false;
  },
  async (db) => {
    const github = createGithubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {});
    const plan = await planExaminedBackfill(db, github);
    console.log(`Attestations to fingerprint: ${plan.attestations}`);
    console.log(`Function rows to write:      ${plan.rows.length}`);
    if (plan.unmatched > 0) console.log(`Answers not on their commit's surface (left out): ${plan.unmatched}`);
    for (const { commit, reason } of plan.skipped) console.log(`Skipped commit ${commit}: ${reason}`);
    if (plan.rows.length === 0) return;
    if (!(await confirmOrCancel(yes, askYesNo, console.log, `Write ${plan.rows.length} rows to examined_functions? [y/N] `))) return;
    console.log(`Wrote ${await applyExaminedBackfill(db, plan)} rows.`);
  },
);
