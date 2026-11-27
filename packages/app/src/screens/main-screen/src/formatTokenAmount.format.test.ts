import { describe, expect, it } from "vitest";
import { formatTokenAmount, localizeAmount } from "./formatTokenAmount";

describe("formatTokenAmount", () => {
  it.each([
    ["10000", 0, "en", "10,000"],
    ["10000", 0, "es", "10.000"],
    ["10000", 0, "ru", "10 000"],
    ["5868900000000", 12, "en", "5.8689"],
    ["5868900000000", 12, "pt-BR", "5,8689"],
    ["1234567890000000", 12, "en", "1,234.5678"],
    ["1234567890000000", 12, "tr", "1.234,5678"],
    ["10000000", 12, "es", "0,0₄1"],
    ["0", 12, "en", "0"],
  ])("shows %s at denomination %i in %s as %s", (atomic, denomination, locale, shown) => {
    expect(formatTokenAmount(atomic, denomination, locale)).toBe(shown);
  });

  it("groups a whole part past float precision exactly", () => {
    expect(formatTokenAmount("123456789012345678901", 0, "en")).toBe("123,456,789,012,345,678,901");
  });

  it("passes an unreadable amount through", () => {
    expect(formatTokenAmount("abc", 12, "en")).toBe("—");
  });
});

describe("localizeAmount", () => {
  it("leaves text that isn't an amount alone", () => {
    expect(localizeAmount("Unavailable", "es")).toBe("Unavailable");
  });

  it("regroups a formatted AR amount", () => {
    expect(localizeAmount("1234.5", "es")).toBe("1234,5");
    expect(localizeAmount("12345.5", "es")).toBe("12.345,5");
  });
});
