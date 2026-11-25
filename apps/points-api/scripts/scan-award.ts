import { awardFinding, parseAwardArgs, type AwardOptions } from "../src/scans/bounty";
import { askYesNo, runScript } from "./cli";

let options: AwardOptions;
await runScript(
  "Usage: scan-award --attestation <id> --severity critical|high|medium|fix|best --ref <https url> [--yes]",
  () => {
    options = parseAwardArgs(process.argv.slice(2).filter((arg) => arg !== "--"));
  },
  async (db) => {
    await awardFinding(db, options, askYesNo, console.log);
  },
);
