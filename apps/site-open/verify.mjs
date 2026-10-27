// Runs as the Vercel build command for this project, so the deploy fails
// while a placeholder is left in either association file: a link that
// never verifies would otherwise ship without anyone noticing.
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const dir = new URL("./.well-known/", import.meta.url);
const files = ["apple-app-site-association", "assetlinks.json"];
const bad = files.filter((f) => /REPLACE/.test(readFileSync(new URL(f, dir), "utf8")));
for (const f of files) JSON.parse(readFileSync(new URL(f, dir), "utf8"));
if (bad.length > 0) {
  process.stderr.write(`Placeholders left in: ${bad.join(", ")}\n`);
  process.exit(1);
}
