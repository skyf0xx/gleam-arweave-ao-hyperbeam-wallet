import { describe, expect, it } from "vitest";
import { marketOf } from "./theme";

describe("marketOf", () => {
  it.each([
    [0.1482, "up"],
    [-0.1617, "down"],
    [0.0005, "up"],
    [0.0004, "flat"],
    [-0.0004, "flat"],
    [0, "flat"],
    [Number.NaN, "flat"],
  ])("reads a change of %s as %s", (change, market) => {
    expect(marketOf(change)).toBe(market);
  });
});
