import { createDropCode, DEFAULT_SITE_URL, formatDropCode, parseDropCodeArgs, type DropCodeOptions } from "../src/wallets/drop-codes";
import { runScript } from "./cli";

let options: DropCodeOptions;
await runScript(
  'Usage: drop-code --label "<text>" (--seats <n> | --unlimited) [--prefix <A-Z>] [--until <ISO date>]',
  (argv) => {
    options = parseDropCodeArgs(argv);
  },
  async (db) => {
    console.log(formatDropCode(await createDropCode(db, options), options.until, process.env.SITE_URL ?? DEFAULT_SITE_URL));
  },
);
