import { describe, expect, it, vi } from "vitest";
import { formatCurrencyParts, formatCurrencyValue } from "./currency";

describe("formatCurrencyValue", () => {
  it("formats fiat with the currency's narrow symbol and own decimals", () => {
    const narrow = (currency: string, value: number) =>
      new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(value);
    expect(formatCurrencyValue(1438.091, "USD")).toBe(narrow("USD", 1438.09));
    expect(formatCurrencyValue(1438.6, "JPY")).toBe(narrow("JPY", 1439));
  });

  it("shows AUD with a bare $, not A$ or AUD", () => {
    const value = formatCurrencyValue(7830.7, "AUD");
    expect(value).toContain("$");
    expect(value).not.toMatch(/A\$|AUD/);
  });

  it("suffixes AR and AO with their ticker", () => {
    expect(formatCurrencyValue(12.3456, "AR")).toBe(`${(12.35).toLocaleString()} AR`);
    expect(formatCurrencyValue(0, "AO")).toBe("0 AO");
  });

  it("keeps small token values from rounding to zero", () => {
    expect(formatCurrencyValue(0.000123, "AR")).toBe(`${(0.000123).toLocaleString(undefined, { maximumFractionDigits: 6 })} AR`);
  });

  it("keeps the ticker apart for tokens and inside the amount for fiat", () => {
    expect(formatCurrencyParts(0, "AO")).toEqual({ amount: "0", unit: "AO" });
    expect(formatCurrencyParts(5, "EUR").unit).toBeUndefined();
  });

  it("moves a letters-only currency to a trailing ISO code", () => {
    const original = Intl.NumberFormat;
    vi.spyOn(Intl, "NumberFormat").mockImplementation(function (_locale, options) {
      return new original("en-US", options);
    });
    try {
      expect(formatCurrencyParts(4.23, "CHF")).toEqual({ amount: "4.23", unit: "CHF" });
      expect(formatCurrencyParts(-1200, "AED")).toEqual({ amount: "-1,200.00", unit: "AED" });
      expect(formatCurrencyValue(4.23, "KES")).toBe("4.23 KES");
      expect(formatCurrencyParts(4.23, "EUR")).toEqual({ amount: "€4.23" });
    } finally {
      vi.restoreAllMocks();
    }
  });
});
