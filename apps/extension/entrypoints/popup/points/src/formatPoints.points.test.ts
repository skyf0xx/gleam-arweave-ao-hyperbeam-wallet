import { describe, expect, it } from "vitest";
import { formatPoints } from "./formatPoints";

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
