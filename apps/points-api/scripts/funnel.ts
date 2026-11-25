import { formatFunnel, readFunnel } from "../src/points/funnel";
import { runScript } from "./cli";

await runScript(
  "Usage: funnel",
  () => {},
  async (db) => {
    console.log(formatFunnel(await readFunnel(db, new Date())));
  },
);
