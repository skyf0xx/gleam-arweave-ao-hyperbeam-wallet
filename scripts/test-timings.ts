// Records how long each test file takes, for the CI shard split
// (`test-shards.ts`). Rerun when the shards drift apart: a stale file only
// unbalances them, and a new test file weighs the median until then.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { TIMINGS_FILE } from "./test-shards";

const report = join(mkdtempSync(join(tmpdir(), "gleam-timings-")), "report.json");
execFileSync("pnpm", ["vitest", "run", "--reporter=json", `--outputFile=${report}`], { stdio: ["ignore", "ignore", "inherit"] });
const { testResults } = JSON.parse(readFileSync(report, "utf8")) as { testResults: { name: string; startTime: number; endTime: number }[] };
const seconds = Object.fromEntries(
  testResults
    .map((r) => [relative(process.cwd(), r.name).split("\\").join("/"), Math.round((r.endTime - r.startTime) / 100) / 10] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1)),
);
writeFileSync(TIMINGS_FILE, `${JSON.stringify(seconds, null, 2)}\n`);
console.log(`Wrote ${testResults.length} file timings to ${TIMINGS_FILE}.`);
