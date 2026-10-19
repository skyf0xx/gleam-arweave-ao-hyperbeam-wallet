import { describe, expect, it } from "vitest";
import { impersonatesRegisteredToken } from "./impersonation";

const flagged = (ticker: string, name: string | null = null) => impersonatesRegisteredToken({ ticker, name });

describe("impersonatesRegisteredToken", () => {
  it("catches registry tickers and names in disguise", () => {
    for (const ticker of ["AO", " ao ", "A0", "a\u200Bo", "ＡＯ", "АО", "wAO", "wAR", "AR", "A.R", "Ào"]) {
      expect(flagged(ticker), ticker).toBe(true);
    }
    expect(flagged("FAKE", "Arweave")).toBe(true);
    expect(flagged("FAKE", " ARWEAVE\u200D")).toBe(true);
  });

  it("leaves unrelated tokens alone", () => {
    for (const ticker of ["FODDER", "wUSDC", "AOX", "STAR", "MATRIX", "W"]) {
      expect(flagged(ticker, ticker), ticker).toBe(false);
    }
  });
});
