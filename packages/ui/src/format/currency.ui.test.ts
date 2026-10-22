import { describe, expect, it } from "vitest";
import { formatCurrencyValue } from "./currency";

describe("formatCurrencyValue", () => {
  it("formats fiat with the currency's own symbol and decimals", () => {
    expect(formatCurrencyValue(1438.091, "USD")).toBe(new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(1438.09));
    expect(formatCurrencyValue(1438.6, "JPY")).toBe(new Intl.NumberFormat(undefined, { style: "currency", currency: "JPY" }).format(1439));
  });

  it("suffixes AR and AO with their ticker", () => {
    expect(formatCurrencyValue(12.3456, "AR")).toBe(`${(12.35).toLocaleString()} AR`);
    expect(formatCurrencyValue(0, "AO")).toBe("0 AO");
  });

  it("keeps small token values from rounding to zero", () => {
    expect(formatCurrencyValue(0.000123, "AR")).toBe(`${(0.000123).toLocaleString(undefined, { maximumFractionDigits: 6 })} AR`);
  });
});
