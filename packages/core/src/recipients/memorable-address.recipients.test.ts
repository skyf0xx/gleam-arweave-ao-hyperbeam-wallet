import { describe, expect, it } from "vitest";
import { addressEmphasisPick, chunkAddress, middleChunks } from "./memorable-address";

const ADDRESS = "weY8dOVhGi9BhGV3B-pkKVWA1ox_n8gzSKOHOJ14uFk";

describe("chunkAddress", () => {
  it("splits a 43-character address into rows of 7 and 4 chunks that rejoin to the address", () => {
    const groups = chunkAddress(ADDRESS, null);
    expect(groups.map((group) => group.length)).toEqual([7, 4]);
    expect(groups.flat().map((chunk) => chunk.text).join("")).toBe(ADDRESS);
    expect(groups[1]!.at(-1)!.text).toBe("uFk");
  });

  it("emphasises the ends and chunks 3 and 7 without a pick", () => {
    const emphasized = chunkAddress(ADDRESS, null).flat().filter((chunk) => chunk.emphasized).map((chunk) => chunk.index);
    expect(emphasized).toEqual([0, 3, 7, 10]);
  });
});

describe("middleChunks", () => {
  it("never picks chunks next to each other or to an end", () => {
    for (let pick = 0; pick < 40; pick++) {
      const [first, second] = middleChunks(11, pick) as [number, number];
      expect(first).toBeGreaterThanOrEqual(2);
      expect(second).toBeLessThanOrEqual(8);
      expect(second - first).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns no pair for an address too short to have one", () => {
    expect(middleChunks(6, null)).toEqual([]);
    expect(middleChunks(7, 5)).toEqual([2, 4]);
  });
});

describe("addressEmphasisPick", () => {
  it("is null without a phrase, and the same for the same word in any case", async () => {
    expect(await addressEmphasisPick(null)).toBeNull();
    const pick = await addressEmphasisPick("Willow");
    expect(pick).toBe(await addressEmphasisPick(" willow "));
    expect(pick).not.toBe(await addressEmphasisPick("harbor"));
  });
});
