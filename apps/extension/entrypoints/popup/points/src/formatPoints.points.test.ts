import { describe, expect, it } from "vitest";
import { formatPoints, formatPointsCompact } from "./formatPoints";

describe("formatPoints", () => {
  it.each([
    ["0", "0.00"],
    ["1000000000000", "1.00"],
    ["12345678900000", "12.34"],
    ["999990000000000", "999.99"],
    ["1234567000000000000", "1,234,567"],
  ])("formats %s atomic as %s", (atomic, expected) => {
    expect(formatPoints(atomic)).toBe(expected);
  });
});

describe("formatPointsCompact", () => {
  it.each([
    ["0", "0.00"],
    ["999990000000000", "999.99"],
    ["1000000000000000", "1K"],
    ["1234000000000000", "1.2K"],
    ["194180000000000000", "194.1K"],
    ["999999000000000000", "999.9K"],
    ["2270000000000000000", "2.2M"],
    ["5000000000000000000000", "5B"],
    ["1234567000000000000000000", "1,234.5B"],
  ])("formats %s atomic as %s", (atomic, expected) => {
    expect(formatPointsCompact(atomic)).toBe(expected);
  });
});
