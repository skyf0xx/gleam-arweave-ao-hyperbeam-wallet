import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitByTime, TIMINGS_FILE } from "./test-shards";

describe("splitByTime", () => {
  it("puts every file in exactly one shard", () => {
    const paths = Array.from({ length: 37 }, (_, i) => `f${i}.test.ts`);
    const shards = splitByTime(paths, {}, 4);
    expect(shards.flat().sort()).toEqual([...paths].sort());
  });

  it("spreads the slow files across shards instead of by name", () => {
    const seconds = { "a.test.ts": 60, "b.test.ts": 50, "c.test.ts": 40, "d.test.ts": 30, "e.test.ts": 5, "f.test.ts": 5 };
    const shards = splitByTime(Object.keys(seconds), seconds, 4);
    const totals = shards.map((paths) => paths.reduce((sum, p) => sum + seconds[p as keyof typeof seconds], 0));
    expect(Math.max(...totals)).toBe(60);
  });

  it("weighs a file with no recorded time as the median", () => {
    const shards = splitByTime(["slow.test.ts", "new.test.ts", "x.test.ts", "y.test.ts"], { "slow.test.ts": 90, "x.test.ts": 10, "y.test.ts": 10 }, 2);
    expect(shards).toEqual([["slow.test.ts"], ["new.test.ts", "x.test.ts", "y.test.ts"]]);
  });

  it("gives the same split whatever order the files arrive in", () => {
    const seconds = { "a.test.ts": 3, "b.test.ts": 3, "c.test.ts": 3 };
    expect(splitByTime(["c.test.ts", "a.test.ts", "b.test.ts"], seconds, 2)).toEqual(splitByTime(["a.test.ts", "b.test.ts", "c.test.ts"], seconds, 2));
  });

  it("reads a timings file of path to seconds", () => {
    const timings = JSON.parse(readFileSync(TIMINGS_FILE, "utf8")) as Record<string, unknown>;
    expect(Object.values(timings).every((value) => typeof value === "number" && value >= 0)).toBe(true);
  });
});
