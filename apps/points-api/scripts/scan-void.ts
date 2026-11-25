import { parseVoidArgs, voidAttestation, type VoidOptions } from "../src/scans/bounty";
import { askYesNo, runScript } from "./cli";

let options: VoidOptions;
await runScript(
  "Usage: scan-void --attestation <id> [--yes]",
  (argv) => {
    options = parseVoidArgs(argv);
  },
  async (db) => {
    await voidAttestation(db, options, askYesNo, console.log);
  },
);
