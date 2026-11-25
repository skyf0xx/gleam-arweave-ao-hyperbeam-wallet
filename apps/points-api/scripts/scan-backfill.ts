import { applyExaminedBackfill, planExaminedBackfill } from "../src/scans/examined-backfill";
import { createGithubClient } from "../src/scans/github";
import { askYesNo, runScript } from "./cli";

let yes = false;
await runScript(
  "Usage: scan-backfill [--yes]",
  () => {
    const args = process.argv.slice(2).filter((arg) => arg !== "--");
    if (args.some((arg) => arg !== "--yes")) throw new Error(`Unknown argument: ${args.find((arg) => arg !== "--yes")}`);
    yes = args.includes("--yes");
  },
  async (db) => {
    const github = createGithubClient(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {});
    const plan = await planExaminedBackfill(db, github);
    console.log(`Attestations to fingerprint: ${plan.attestations}`);
    console.log(`Function rows to write:      ${plan.rows.length}`);
    if (plan.unmatched > 0) console.log(`Answers not on their commit's surface (left out): ${plan.unmatched}`);
    for (const { commit, reason } of plan.skipped) console.log(`Skipped commit ${commit}: ${reason}`);
    if (plan.rows.length === 0) return;
    if (!yes && !(await askYesNo(`Write ${plan.rows.length} rows to examined_functions? [y/N] `))) {
      console.log("Cancelled. Nothing was written.");
      return;
    }
    console.log(`Wrote ${await applyExaminedBackfill(db, plan)} rows.`);
  },
);
