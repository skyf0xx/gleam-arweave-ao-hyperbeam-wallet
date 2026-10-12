import { describe, expect, it } from "vitest";
import { curve, isqrt } from "./curve";

const AR = 10n ** 12n;

describe("isqrt", () => {
  it("floors the root", () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(1n)).toBe(1n);
    expect(isqrt(15n)).toBe(3n);
    expect(isqrt(16n)).toBe(4n);
    expect(isqrt(10n ** 40n)).toBe(10n ** 20n);
    expect(isqrt(10n ** 40n - 1n)).toBe(10n ** 20n - 1n);
  });

  it("rejects negatives", () => {
    expect(() => isqrt(-1n)).toThrow();
  });
});

describe("curve", () => {
  it("is linear up to 100", () => {
    expect(curve(0n)).toBe(0n);
    expect(curve(37n * AR)).toBe(37n * AR);
    expect(curve(100n * AR)).toBe(100n * AR);
  });

  it("matches the published table, which rounds where this floors (6,224.55)", () => {
    expect(curve(1_000n * AR) / AR).toBe(532n);
    expect(curve(10_000n * AR) / AR).toBe(1_900n);
    expect(curve(100_000n * AR) / AR).toBe(6_224n);
  });

  it("is continuous across the knee", () => {
    const above = curve(100n * AR + 1n);
    expect(above).toBeGreaterThanOrEqual(100n * AR);
    expect(above).toBeLessThanOrEqual(100n * AR + 1n);
  });

  it("pays less for one big balance than for the same split in two", () => {
    expect(curve(1_000n * AR)).toBeLessThan(curve(500n * AR) * 2n);
  });
});
