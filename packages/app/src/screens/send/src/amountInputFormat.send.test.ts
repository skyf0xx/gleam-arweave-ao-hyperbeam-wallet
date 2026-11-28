import { describe, expect, it } from "vitest";
import { caretAfter, formatAmountInput, parseAmountInput, significantBefore } from "./amountInputFormat";

describe("amount input format", () => {
  it("groups the integer part and keeps the fraction as typed", () => {
    expect(formatAmountInput("10000", "en")).toBe("10,000");
    expect(formatAmountInput("1234567.50", "en")).toBe("1,234,567.50");
    expect(formatAmountInput("12.", "en")).toBe("12.");
    expect(formatAmountInput("", "en")).toBe("");
    expect(formatAmountInput("1000.5", "de")).toBe("1.000,5");
  });

  it("parses a grouped display back to the canonical amount", () => {
    expect(parseAmountInput("10,000", "en")).toBe("10000");
    expect(parseAmountInput("1.000,5", "de")).toBe("1000.5");
    expect(parseAmountInput("1,5", "de")).toBe("1.5");
    expect(parseAmountInput("1.5.2abc", "en")).toBe("1.52");
  });

  it("keeps the caret among the digits across regrouping", () => {
    expect(significantBefore("1,0000", 6, "en")).toBe(5);
    expect(caretAfter("10,000", 5, "en")).toBe(6);
    expect(caretAfter("10,000", 2, "en")).toBe(2);
    expect(caretAfter("10,000", 3, "en")).toBe(4);
  });
});
