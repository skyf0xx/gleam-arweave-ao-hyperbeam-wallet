import { describe, expect, it } from "vitest";
import {
  APPROVAL_METHODS,
  KEY_METHODS,
  PERMISSION_TYPES,
  PROVIDER_METHODS,
} from "./permissions";

describe("messaging's permissions re-export", () => {
  it("re-exports the same PERMISSION_TYPES values as core", () => {
    expect(PERMISSION_TYPES).toContain("ACCESS_ADDRESS");
    expect(PERMISSION_TYPES).toContain("SIGN_TRANSACTION");
  });

  it("re-exports disjoint method privilege tiers", () => {
    const providerSet = new Set<string>(PROVIDER_METHODS);
    for (const method of APPROVAL_METHODS) {
      expect(providerSet.has(method)).toBe(false);
    }
    for (const method of KEY_METHODS) {
      expect(providerSet.has(method)).toBe(false);
    }
  });
});
