import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

export const TIMINGS_FILE = "scripts/test-timings.json";

/**
 * Puts each file in the shard with the least recorded time so far, longest
 * file first. Vitest's own split hashes paths into equal file counts, which
 * put several of the slow vault and points-api files in one shard. A file
 * with no recorded time weighs the median. Every shard computes the same
 * split, so each file runs exactly once.
 */
export function splitByTime(paths: readonly string[], seconds: Readonly<Record<string, number>>, count: number): string[][] {
  const known = Object.values(seconds).sort((a, b) => a - b);
  const fallback = known.length > 0 ? known[Math.floor(known.length / 2)] : 1;
  const weight = (path: string) => seconds[path] ?? fallback;
  const shards = Array.from({ length: count }, () => ({ total: 0, paths: [] as string[] }));
  const ordered = [...paths].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  for (const path of ordered) {
    const lightest = shards.reduce((min, shard) => (shard.total < min.total ? shard : min));
    lightest.total += weight(path);
    lightest.paths.push(path);
  }
  return shards.map((shard) => shard.paths);
}

function readTimings(root: string): Record<string, number> {
  try {
    return JSON.parse(readFileSync(join(root, TIMINGS_FILE), "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

export class TimedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    if (!shard) return files;
    const pathOf = (spec: TestSpecification) => relative(root, spec.moduleId).split("\\").join("/");
    const mine = new Set(splitByTime(files.map(pathOf), readTimings(root), shard.count)[shard.index - 1]);
    return files.filter((spec) => mine.has(pathOf(spec)));
  }
}
