import { describe, expect, it, vi } from "vitest";
import { getHistoricalUsdPrices, buildPriceAtFromSeries } from "./historical";
import { estimateHistoricalPortfolioValue } from "./portfolio";

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const API = "https://api.example.test";
const AR = { coinGeckoId: "arweave" };

describe("getHistoricalUsdPrices", () => {
  it("returns a time-ordered series from the server's proxy", async () => {
    const fetchImpl = fakeFetch({
      series: [
        { timestamp: 2000, usd: 12.5 },
        { timestamp: 1000, usd: 10 },
      ],
    });
    const series = await getHistoricalUsdPrices(AR, "7D", API, fetchImpl);
    expect(series).toEqual([
      { timestamp: 1000, usd: 10 },
      { timestamp: 2000, usd: 12.5 },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(`${API}/prices/history?id=arweave&range=7D`, { signal: expect.any(AbortSignal) });
  });

  it("drops malformed points", async () => {
    const fetchImpl = fakeFetch({ series: [{ timestamp: 1, usd: 2 }, { timestamp: "x", usd: 3 }, null] });
    expect(await getHistoricalUsdPrices(AR, "1M", API, fetchImpl)).toEqual([{ timestamp: 1, usd: 2 }]);
  });

  it("returns an empty series when the series is absent from the body", async () => {
    expect(await getHistoricalUsdPrices(AR, "24H", API, fakeFetch({}))).toEqual([]);
  });

  it("returns an empty series (never throws) on a non-2xx response", async () => {
    expect(await getHistoricalUsdPrices(AR, "1Y", API, fakeFetch(null, false, 500))).toEqual([]);
  });

  it("returns an empty series when the request itself fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await getHistoricalUsdPrices(AR, "ALL", API, fetchImpl)).toEqual([]);
  });
});

describe("buildPriceAtFromSeries", () => {
  it("returns the nearest at-or-before price for a given timestamp", () => {
    const priceAt = buildPriceAtFromSeries([
      { timestamp: 1000, usd: 10 },
      { timestamp: 2000, usd: 20 },
    ]);
    expect(priceAt(1500)).toBe(10);
    expect(priceAt(2000)).toBe(20);
    expect(priceAt(3000)).toBe(20);
  });

  it("uses the earliest price for a timestamp before the series starts", () => {
    const priceAt = buildPriceAtFromSeries([
      { timestamp: 3000, usd: 30 },
      { timestamp: 2000, usd: 20 },
    ]);
    expect(priceAt(500)).toBe(20);
  });

  it("returns 0 for an empty series", () => {
    const emptyPriceAt = buildPriceAtFromSeries([]);
    expect(emptyPriceAt(1000)).toBe(0);
  });

  it("keeps a token whose series starts after the timeline's first point in that point's total", () => {
    // AR's series sets the timeline; AO's starts a few seconds later.
    const ar = { balance: 1, priceAt: buildPriceAtFromSeries([{ timestamp: 1000, usd: 1 }, { timestamp: 2000, usd: 1 }]) };
    const ao = { balance: 1, priceAt: buildPriceAtFromSeries([{ timestamp: 1005, usd: 9 }, { timestamp: 2000, usd: 9 }]) };
    const first = estimateHistoricalPortfolioValue([ar, ao], 1000);
    const last = estimateHistoricalPortfolioValue([ar, ao], 2000);
    expect(first).toBe(last);
  });
});

describe("estimateHistoricalPortfolioValue", () => {
  it("sums balance * priceAt(timestamp) across multiple tokens", () => {
    const total = estimateHistoricalPortfolioValue(
      [
        { balance: 2, priceAt: () => 10 },
        { balance: 3, priceAt: () => 5 },
      ],
      1000,
    );
    expect(total).toBe(35);
  });

  it("contributes 0 for a token whose priceAt returns 0 at that timestamp, without erroring or excluding it", () => {
    const total = estimateHistoricalPortfolioValue(
      [
        { balance: 100, priceAt: () => 0 },
        { balance: 3, priceAt: () => 5 },
      ],
      1000,
    );
    expect(total).toBe(15);
  });

  it("returns 0 for an empty tokens array", () => {
    const total = estimateHistoricalPortfolioValue([], 1000);
    expect(total).toBe(0);
  });
});
