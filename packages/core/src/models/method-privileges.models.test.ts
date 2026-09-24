import { describe, expect, it } from "vitest";
import {
  APPROVAL_METHODS,
  KEY_METHODS,
  PROVIDER_METHODS,
} from "./method-privileges";

function intersection(a: readonly string[], b: readonly string[]): string[] {
  const bSet = new Set(b);
  return a.filter((value) => bSet.has(value));
}

describe("method privilege tiers", () => {
  it("PROVIDER_METHODS and APPROVAL_METHODS are disjoint", () => {
    expect(intersection(PROVIDER_METHODS, APPROVAL_METHODS)).toEqual([]);
  });

  it("PROVIDER_METHODS and KEY_METHODS are disjoint", () => {
    expect(intersection(PROVIDER_METHODS, KEY_METHODS)).toEqual([]);
  });

  it("APPROVAL_METHODS and KEY_METHODS are disjoint", () => {
    expect(intersection(APPROVAL_METHODS, KEY_METHODS)).toEqual([]);
  });

  it("KEY_METHODS never contains a page-reachable method", () => {
    for (const method of KEY_METHODS) {
      expect(PROVIDER_METHODS as readonly string[]).not.toContain(method);
    }
  });

  it("PROVIDER_METHODS matches the ArConnect-compatible provider surface exactly", () => {
    expect([...PROVIDER_METHODS].sort()).toEqual(
      [
        "connect",
        "disconnect",
        "getPermissions",
        "getActiveAddress",
        "getAllAddresses",
        "getActivePublicKey",
        "getWalletNames",
        "getArweaveConfig",
        "getBalances",
        "sign",
        "dispatch",
        "encrypt",
        "decrypt",
        "signature",
        "signMessage",
        "privateHash",
        "verifyMessage",
        "signDataItem",
        "batchSignDataItem",
        "transferAoTokens",
        "tokenBalance",
        "userTokens",
        "addToken",
        "isTokenAdded",
      ].sort(),
    );
  });

  it("each set has no duplicate entries", () => {
    for (const set of [PROVIDER_METHODS, APPROVAL_METHODS, KEY_METHODS]) {
      expect(new Set(set).size).toBe(set.length);
    }
  });
});
