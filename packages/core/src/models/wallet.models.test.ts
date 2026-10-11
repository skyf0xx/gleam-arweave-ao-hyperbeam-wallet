import { describe, expect, it } from "vitest";
import { isHardwareWalletMethod, vaultHasPassword } from "./wallet";

describe("wallet methods", () => {
  it("treats only keystone and ledger as hardware", () => {
    expect(isHardwareWalletMethod("keystone")).toBe(true);
    expect(isHardwareWalletMethod("ledger")).toBe(true);
    expect(isHardwareWalletMethod("jwk")).toBe(false);
  });

  it("a vault has a password only when it holds a keyfile wallet", () => {
    expect(vaultHasPassword([])).toBe(false);
    expect(vaultHasPassword([{ method: "keystone" }, { method: "ledger" }])).toBe(false);
    expect(vaultHasPassword([{ method: "keystone" }, { method: "jwk" }])).toBe(true);
  });
});
