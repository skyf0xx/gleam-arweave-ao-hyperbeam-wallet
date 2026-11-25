import { dockAttestation, parseDockArgs, type DockOptions } from "../src/scans/bounty";
import { askYesNo, runScript } from "./cli";

let options: DockOptions;
await runScript(
  "Usage: scan-dock --attestation <id> --ref <https url> [--yes]",
  (argv) => {
    options = parseDockArgs(argv);
  },
  async (db) => {
    await dockAttestation(db, options, askYesNo, console.log);
  },
);
