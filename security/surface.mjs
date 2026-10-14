// Shared by the surface test and the release gate, so both read
// security/surface.txt the same way. Plain .mjs so the gate runs on bare Node.

/**
 * @typedef {{ line: string, tier: string, path: string, rest: string[] }} SurfaceEntry
 */

/**
 * Parses surface.txt text into raw entries. Blank lines and `#` comments are
 * skipped; nothing is validated, so the test can report each bad line.
 * @param {string} text
 * @returns {SurfaceEntry[]}
 */
export function parseSurface(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [tier = "", path = "", ...rest] = line.split(/\s+/);
      return { line, tier, path, rest };
    });
}

/**
 * Parses and validates surface.txt text, returning its paths.
 * @param {string} text
 * @returns {string[]}
 * @throws {Error} on a line that isn't `<tier 1-5> <path>`
 */
export function surfacePaths(text) {
  return parseSurface(text).map((entry) => {
    if (!/^[1-5]$/.test(entry.tier) || entry.path === "" || entry.rest.length > 0) {
      throw new Error(`malformed surface line: "${entry.line}"`);
    }
    return entry.path;
  });
}
