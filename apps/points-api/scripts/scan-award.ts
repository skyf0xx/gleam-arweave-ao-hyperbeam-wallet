import { awardFinding, parseAwardArgs, type AwardOptions } from "../src/scans/bounty";
import { askYesNo, runScript } from "./cli";

let options: AwardOptions;
await runScript(
  "Usage: scan-award --attestation <id> --severity critical|high|medium|fix|best --ref <https url> [--yes]",
  (argv) => {
    options = parseAwardArgs(argv);
  },
  async (db) => {
    await awardFinding(db, options, askYesNo, console.log);
  },
);
