import { describe, expect, it } from "vitest";
import { computeDailyPoints, estimatePoints, ownDailyRate, type WalletSnapshot } from "./formula";

const ONE = "1000000000000";

function wallet(address: string, overrides: Partial<WalletSnapshot> = {}): WalletSnapshot {
  return { address, arAtomic: "0", aoAtomic: "0", live: true, referredBy: null, originalFounder: false, ...overrides };
}

describe("computeDailyPoints", () => {
  it("weights 1 AR and 1 AO equally", () => {
    const points = computeDailyPoints([wallet("a", { arAtomic: ONE, aoAtomic: ONE })]);

    expect(points.get("a")).toEqual({
      holdingAtomic: "2000000000000",
      refereeBonusAtomic: "0",
      founderBonusAtomic: "0",
      referrerBonusAtomic: "0",
      totalAtomic: "2000000000000",
    });
  });

  it("gives a wallet that isn't live nothing", () => {
    expect(computeDailyPoints([wallet("a", { arAtomic: ONE, live: false })]).get("a")?.totalAtomic).toBe("0");
  });

  it("pays 10% of the referee's base to both sides", () => {
    const points = computeDailyPoints([
      wallet("referrer", { arAtomic: ONE }),
      wallet("referee", { aoAtomic: "50", referredBy: "referrer" }),
    ]);

    expect(points.get("referee")).toMatchObject({ holdingAtomic: "50", refereeBonusAtomic: "5", totalAtomic: "55" });
    expect(points.get("referrer")).toMatchObject({ referrerBonusAtomic: "5", totalAtomic: "1000000000005" });
  });

  it("gives an original founder the 10% with nobody paid for it", () => {
    const points = computeDailyPoints([
      wallet("founder", { arAtomic: "105", originalFounder: true }),
      wallet("other", { arAtomic: "50" }),
    ]);

    expect(points.get("founder")).toMatchObject({
      refereeBonusAtomic: "0",
      founderBonusAtomic: "10",
      referrerBonusAtomic: "0",
      totalAtomic: "115",
    });
    expect(points.get("other")?.totalAtomic).toBe("50");
  });

  it("gives an original founder with a referrer the 10% once, as a referee", () => {
    const points = computeDailyPoints([
      wallet("referrer", { arAtomic: "1000" }),
      wallet("founder", { arAtomic: "100", referredBy: "referrer", originalFounder: true }),
    ]);

    expect(points.get("founder")).toMatchObject({ refereeBonusAtomic: "10", founderBonusAtomic: "0", totalAtomic: "110" });
    expect(points.get("referrer")?.referrerBonusAtomic).toBe("10");
  });

  it("gives a wallet that isn't an original founder nothing extra", () => {
    expect(computeDailyPoints([wallet("joiner", { arAtomic: "100" })]).get("joiner")).toMatchObject({
      founderBonusAtomic: "0",
      totalAtomic: "100",
    });
  });

  it("sums bonuses across referees but never pays on a referee's own referral points", () => {
    const points = computeDailyPoints([
      wallet("top"),
      wallet("mid", { arAtomic: "100", referredBy: "top" }),
      wallet("leaf", { arAtomic: "1000", referredBy: "mid" }),
      wallet("other", { arAtomic: "200", referredBy: "top" }),
    ]);

    // mid's referrer bonus from leaf (100) doesn't flow up to top.
    expect(points.get("top")?.referrerBonusAtomic).toBe("30");
    expect(points.get("mid")?.referrerBonusAtomic).toBe("100");
  });

  it("rounds bonuses down", () => {
    const points = computeDailyPoints([wallet("r"), wallet("e", { arAtomic: "19", referredBy: "r" })]);

    expect(points.get("e")?.refereeBonusAtomic).toBe("1");
    expect(points.get("r")?.referrerBonusAtomic).toBe("1");
  });

  it("skips the referrer bonus when the referrer isn't live or isn't in the snapshot", () => {
    const points = computeDailyPoints([
      wallet("asleep", { live: false }),
      wallet("e1", { arAtomic: "100", referredBy: "asleep" }),
      wallet("e2", { arAtomic: "100", referredBy: "gone" }),
    ]);

    expect(points.get("asleep")?.referrerBonusAtomic).toBe("0");
    expect(points.get("e1")?.refereeBonusAtomic).toBe("10");
    expect(points.get("e2")?.refereeBonusAtomic).toBe("10");
  });

  it("ignores a wallet that names itself as its referrer", () => {
    const points = computeDailyPoints([wallet("me", { arAtomic: "100", referredBy: "me" })]);

    expect(points.get("me")?.totalAtomic).toBe("100");
  });

  it("rejects a duplicated wallet and a non-integer balance", () => {
    expect(() => computeDailyPoints([wallet("a"), wallet("a")])).toThrow(/twice/);
    expect(() => computeDailyPoints([wallet("a", { arAtomic: "1.5" })])).toThrow(/atomic/);
  });
});

describe("estimatePoints", () => {
  const settledAtMs = Date.UTC(2026, 9, 8);

  it("accrues the daily rate pro rata", () => {
    expect(
      estimatePoints({ settledAtomic: "1000", dailyRateAtomic: "240", settledAtMs, nowMs: settledAtMs + 3_600_000 }),
    ).toBe("1010");
  });

  it("stops projecting after one day and never goes backwards", () => {
    const base = { settledAtomic: "1000", dailyRateAtomic: "240", settledAtMs };

    expect(estimatePoints({ ...base, nowMs: settledAtMs + 5 * 86_400_000 })).toBe("1240");
    expect(estimatePoints({ ...base, nowMs: settledAtMs - 1000 })).toBe("1000");
  });
});

describe("ownDailyRate", () => {
  it("adds the referee bonus only when referred", () => {
    expect(ownDailyRate("100", "50", false)).toBe("150");
    expect(ownDailyRate("100", "50", true)).toBe("165");
  });

  it("adds it for an original founder, once", () => {
    expect(ownDailyRate("100", "50", false, true)).toBe("165");
    expect(ownDailyRate("100", "50", true, true)).toBe("165");
  });
});
