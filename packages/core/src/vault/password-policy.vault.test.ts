import { describe, expect, it } from "vitest";
import { validatePassword } from "./password-policy";

describe("validatePassword", () => {
  it("rejects passwords shorter than 12 characters", () => {
    const result = validatePassword("short1!");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/at least 12 characters/i);
    }
  });

  it("rejects a common/breached password even if long enough", () => {
    const result = validatePassword("loginpassword");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/too common/i);
    }
  });

  it("rejects a common password regardless of case", () => {
    const result = validatePassword("LoGiNpAsSwOrD");
    expect(result.valid).toBe(false);
  });

  it("accepts a sufficiently long, non-common password", () => {
    const result = validatePassword("Tr0ub4dor&Skyfoxx!");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a password exactly at the minimum length boundary", () => {
    const result = validatePassword("Xk9#mQ2!vR4p");
    expect(result.valid).toBe(true);
  });

  it("rejects a password one character under the minimum length boundary", () => {
    const result = validatePassword("Xk9#mQ2!vR4");
    expect(result.valid).toBe(false);
  });
});
