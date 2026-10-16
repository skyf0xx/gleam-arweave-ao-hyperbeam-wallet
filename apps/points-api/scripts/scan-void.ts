import { parseVoidArgs, voidAttestation, type VoidOptions } from "../src/bounty";
import { askYesNo, runScript } from "./cli";

let options: VoidOptions;
await runScript(
  "Usage: scan-void --attestation <id> [--yes]",
  () => {
    options = parseVoidArgs(process.argv.slice(2).filter((arg) => arg !== "--"));
  },
  async (db) => {
    await voidAttestation(db, options, askYesNo, console.log);
  },
);
