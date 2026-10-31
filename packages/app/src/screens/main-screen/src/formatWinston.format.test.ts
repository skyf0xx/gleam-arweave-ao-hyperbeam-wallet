import { describe, expect, it } from "vitest";
import { formatAtomicCompact } from "./formatWinston";

describe("formatAtomicCompact", () => {
  it.each([
    ["10000000", 12, "0.0₄1"],
    ["1", 12, "0.0₁₁1"],
    ["12345678", 12, "0.0₄1234"],
    ["12000000", 12, "0.0₄12"],
  ])("counts the zeros of %s at denomination %i", (atomic, denomination, shown) => {
    expect(formatAtomicCompact(atomic, denomination)).toBe(shown);
  });

  it.each([
    ["0", 12, "0"],
    ["100000000", 12, "0.0001"],
    ["300000000000", 12, "0.3"],
    ["2487100000000", 12, "2.4871"],
    ["500", 0, "500"],
  ])("leaves %s at denomination %i alone", (atomic, denomination, shown) => {
    expect(formatAtomicCompact(atomic, denomination)).toBe(shown);
  });

  it("keeps the whole part's rounding: 1.00001 still reads 1", () => {
    expect(formatAtomicCompact("1000010000000", 12)).toBe("1");
  });
});
