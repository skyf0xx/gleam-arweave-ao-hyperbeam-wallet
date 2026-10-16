import { isJsxPath, scanFile } from "./functions";

export type SurfaceTier = 1 | 2 | 3 | 4 | 5;

export interface SurfaceEntry {
  tier: SurfaceTier;
  /** A file, or a directory when it ends in `/`. */
  path: string;
}

/** A function in a surface file, as challenges and the coverage figure count it. */
export interface SurfaceFunction {
  file: string;
  symbol: string;
  startLine: number;
  endLine: number;
}

/**
 * Parses `security/surface.txt`: `<tier> <path>` lines, `#` comments and
 * blank lines. Same rules as `security/surface.mjs`, which the release
 * gate runs on bare Node.
 *
 * @throws on a line that isn't `<tier 1-5> <path>`
 */
export function parseSurfaceText(text: string): SurfaceEntry[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [tier = "", path = "", ...rest] = line.split(/\s+/);
      if (!/^[1-5]$/.test(tier) || path === "" || rest.length > 0) {
        throw new Error(`malformed surface line: "${line}"`);
      }
      return { tier: Number(tier) as SurfaceTier, path };
    });
}

/**
 * Whether a challenge may name functions in this file: TypeScript source,
 * not a test (its checks guard nothing) and not a `.d.ts` (no bodies).
 * The surface also lists config and CI files; those are skipped.
 */
export function isScannablePath(path: string): boolean {
  if (!/\.tsx?$/.test(path) || path.endsWith(".d.ts")) return false;
  return !/\.(test|spec)\.tsx?$/.test(path);
}

/**
 * The scannable files the surface covers, sorted. Core can't list a
 * directory, so the caller passes every file path at the commit (from
 * `git ls-files` or the GitHub tree API).
 */
export function surfaceFiles(entries: readonly SurfaceEntry[], repoPaths: readonly string[]): string[] {
  const covered = new Set<string>();
  for (const path of repoPaths) {
    if (!isScannablePath(path)) continue;
    const inSurface = entries.some((entry) =>
      entry.path.endsWith("/") ? path.startsWith(entry.path) : path === entry.path,
    );
    if (inSurface) covered.add(path);
  }
  return [...covered].sort();
}

/**
 * The challenge pool and the coverage denominator: every function in the
 * given surface files that makes a check (`ScannedFile.checking`), sorted
 * by file then position. A function with no `if`, `throw` or `switch` of
 * its own has no check line for an answer to cite. A file over
 * `MAX_SCAN_FILE_BYTES` contributes nothing.
 */
export function listSurfaceFunctions(files: readonly { path: string; text: string }[]): SurfaceFunction[] {
  return [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .flatMap((file) => {
      const scanned = scanFile(file.text, { jsx: isJsxPath(file.path) });
      return scanned.functions.filter((fn) => scanned.checking.has(fn.symbol)).map((fn) => ({
        file: file.path,
        symbol: fn.symbol,
        startLine: fn.startLine,
        endLine: fn.endLine,
      }));
    });
}
