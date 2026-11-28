import { describe, expect, it } from "vitest";
import { caretAfter, formatAmountInput, parseAmountEdit, parseAmountInput } from "./amountInputFormat";

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
    expect(caretAfter("10,000", 5, "en")).toBe(6);
    expect(caretAfter("10,000", 2, "en")).toBe(2);
    expect(caretAfter("10,000", 3, "en")).toBe(4);
  });

  it("reads a typed . as the decimal point where . is also the group character", () => {
    const typed = { inputType: "insertText", data: "." };
    for (const locale of ["pt-BR", "de", "es"]) {
      expect(parseAmountEdit("1.", 2, typed, locale)).toBe("1.");
      expect(parseAmountEdit("1.5", 2, typed, locale)).toBe("1.5");
      expect(parseAmountEdit("1,5", 3, { inputType: "insertText", data: "5" }, locale)).toBe("1.5");
    }
    expect(parseAmountEdit("1.000,5", 7, { inputType: "insertText", data: "5" }, "pt-BR")).toBe("1000.5");
    expect(parseAmountEdit("1,5", 2, { inputType: "insertText", data: "," }, "en")).toBe("15");
  });

  it("splits a pasted . by its digit count and leaves a deletion inside a group alone", () => {
    const paste = { inputType: "insertFromPaste", data: null };
    expect(parseAmountEdit("1.5", 3, paste, "pt-BR")).toBe("1.5");
    expect(parseAmountEdit("10.000", 6, paste, "pt-BR")).toBe("10000");
    expect(parseAmountEdit("1.000.000", 9, paste, "pt-BR")).toBe("1000000");
    expect(parseAmountEdit("1.000,5", 7, paste, "pt-BR")).toBe("1000.5");
    expect(parseAmountEdit("1.00", 4, { inputType: "deleteContentBackward", data: null }, "pt-BR")).toBe("100");
  });
});
