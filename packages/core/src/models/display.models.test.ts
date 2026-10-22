import { describe, expect, it } from "vitest";
import { defaultDisplayCurrency } from "./display";

describe("defaultDisplayCurrency", () => {
  it.each([
    ["en-US", "USD"],
    ["en-GB", "GBP"],
    ["de-AT", "EUR"],
    ["fr_FR", "EUR"],
    ["sw-KE", "KES"],
    ["zh-Hant-HK", "HKD"],
    ["ja", "USD"],
    ["en-AQ", "USD"],
    [undefined, "USD"],
  ])("maps %s to %s", (locale, currency) => {
    expect(defaultDisplayCurrency(locale)).toBe(currency);
  });
});
