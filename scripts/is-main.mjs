// @ts-check
// Plain .mjs with JSDoc so the scripts that run on bare Node can import it.
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Whether the module at `metaUrl` (its `import.meta.url`) is the script
 * Node was started on, as opposed to one that imported it.
 * @param {string} metaUrl
 */
export function isMain(metaUrl) {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}
