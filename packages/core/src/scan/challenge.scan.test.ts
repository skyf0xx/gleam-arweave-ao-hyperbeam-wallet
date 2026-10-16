import { describe, expect, it } from "vitest";
import { pickChallenge, type ChallengeFunction } from "./challenge";

const functions: ChallengeFunction[] = ["a.ts", "b.ts", "c.ts", "d.ts"].flatMap((file) =>
  ["one", "two", "three"].map((symbol) => ({ file, symbol })),
);

describe("pickChallenge", () => {
  // Fixed-seed vector: a change to the draw changes every stored challenge.
  it("is deterministic for a seed, whatever order the functions come in", async () => {
    const first = await pickChallenge(functions, "seed-1");

    expect(await pickChallenge([...functions].reverse(), "seed-1")).toEqual(first);
    expect(await pickChallenge(functions, new TextEncoder().encode("seed-1"))).toEqual(first);
    expect(first).toEqual(PINNED);
  });

  it("picks three distinct functions from three distinct files", async () => {
    for (let seed = 0; seed < 50; seed++) {
      const picked = await pickChallenge(functions, `seed-${seed}`);
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((fn) => fn.file)).size).toBe(3);
    }
  });

  it("varies with the seed", async () => {
    const draws = new Set<string>();
    for (let seed = 0; seed < 20; seed++) draws.add(JSON.stringify(await pickChallenge(functions, `seed-${seed}`)));

    expect(draws.size).toBeGreaterThan(10);
  });

  it("repeats a file only when fewer than three files remain", async () => {
    const twoFiles = functions.filter((fn) => fn.file === "a.ts" || fn.file === "b.ts");
    const picked = await pickChallenge(twoFiles, "seed");

    expect(new Set(picked.map((fn) => `${fn.file}#${fn.symbol}`)).size).toBe(3);
    expect(new Set(picked.map((fn) => fn.file)).size).toBe(2);
  });

  it("takes all three when the pool is exactly three functions in one file", async () => {
    const pool = ["one", "two", "three"].map((symbol) => ({ file: "only.ts", symbol }));

    expect(new Set((await pickChallenge(pool, "seed")).map((fn) => fn.symbol))).toEqual(new Set(["one", "two", "three"]));
  });

  it("ignores repeated entries and refuses too few functions or an empty seed", async () => {
    const one = { file: "a.ts", symbol: "one" };

    await expect(pickChallenge([one, one, one, { file: "b.ts", symbol: "x" }], "s")).rejects.toThrow(/at least 3/);
    await expect(pickChallenge(functions, "")).rejects.toThrow(/empty/);
  });
});

const PINNED: ChallengeFunction[] = [
  { file: "d.ts", symbol: "two" },
  { file: "c.ts", symbol: "three" },
  { file: "a.ts", symbol: "three" },
];
