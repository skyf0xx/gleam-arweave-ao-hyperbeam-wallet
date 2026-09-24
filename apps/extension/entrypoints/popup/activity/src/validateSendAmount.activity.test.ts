import { describe, expect, it } from "vitest";
import type { TokenBalance } from "@gleam/core";
import { validateSendAmount } from "./validateSendAmount";
import type { WalletBalances } from "./useBalances";

const AR_BALANCE = "1000000000000"; // 1 AR
const AO_TOKEN: TokenBalance = {
  address: "addr",
  processId: "process-1",
  ticker: "ARDRIVE",
  denomination: 6,
  name: null,
  quantity: "5000000",
};

function balances(overrides: Partial<WalletBalances> = {}): WalletBalances {
  return { arBalance: AR_BALANCE, tokenBalances: [AO_TOKEN], ...overrides };
}

describe("validateSendAmount", () => {
  it("allows an AR amount that leaves room for the fee", () => {
    expect(validateSendAmount("900000000000", null, balances(), "50000000000")).toBeNull();
  });

  it("blocks an AR amount that alone fits the balance but overflows once the fee is added", () => {
    // amount === balance, fee on top pushes it over.
    expect(validateSendAmount(AR_BALANCE, null, balances(), "50000000000")).toBe(
      "That's more than your current balance.",
    );
  });

  it("allows amount + fee exactly equal to the balance", () => {
    const fee = "50000000000";
    const amount = (BigInt(AR_BALANCE) - BigInt(fee)).toString();
    expect(validateSendAmount(amount, null, balances(), fee)).toBeNull();
  });

  it("skips the fee-inclusive check when the fee estimate hasn't loaded yet", () => {
    // Without a fee, plain amount <= balance is still enforced...
    expect(validateSendAmount(AR_BALANCE, null, balances())).toBeNull();
    // ...but an amount over balance alone is still blocked regardless of fee.
    expect(validateSendAmount((BigInt(AR_BALANCE) + 1n).toString(), null, balances())).toBe(
      "That's more than your current balance.",
    );
  });

  it("ignores the fee for an AO token send, which has no sender-side fee", () => {
    expect(validateSendAmount("5000000", AO_TOKEN, balances(), "50000000000")).toBeNull();
  });

  it("still blocks an AO amount over its own token balance regardless of the AR fee", () => {
    expect(validateSendAmount("5000001", AO_TOKEN, balances(), "50000000000")).toBe(
      "That's more than your current balance.",
    );
  });

  it("returns null when balances haven't loaded yet", () => {
    expect(validateSendAmount(AR_BALANCE, null, undefined, "50000000000")).toBeNull();
  });
});
