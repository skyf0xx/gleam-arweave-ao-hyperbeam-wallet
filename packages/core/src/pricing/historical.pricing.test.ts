import { describe, expect, it, vi } from "vitest";
import {
  getHistoricalUsdPrices,
  getHistoricalUsdPricesFromCoinPaprika,
  getHistoricalUsdPricesWithFallback,
  buildPriceAtFromSeries,
} from "./historical";
import { estimateHistoricalPortfolioValue } from "./portfolio";

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("getHistoricalUsdPrices (CoinGecko)", () => {
  it("returns a time-ordered series from the market_chart response", async () => {
    const fetchImpl = fakeFetch({
      prices: [
        [2000, 12.5],
        [1000, 10],
      ],
    });
    const series = await getHistoricalUsdPrices("arweave", "7D", fetchImpl);
    expect(series).toEqual([
      { timestamp: 1000, usd: 10 },
      { timestamp: 2000, usd: 12.5 },
    ]);
  });

  it("returns an empty series when prices are absent from the body", async () => {
    const fetchImpl = fakeFetch({});
    const series = await getHistoricalUsdPrices("arweave", "24H", fetchImpl);
    expect(series).toEqual([]);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(null, false, 429);
    await expect(getHistoricalUsdPrices("arweave", "1M", fetchImpl)).rejects.toThrow(/HTTP 429/);
  });
});

describe("getHistoricalUsdPricesFromCoinPaprika", () => {
  it("returns a time-ordered series from the historical ticker response", async () => {
    const fetchImpl = fakeFetch([
      { timestamp: "2024-01-02T00:00:00Z", price: 11 },
      { timestamp: "2024-01-01T00:00:00Z", price: 9 },
    ]);
    const series = await getHistoricalUsdPricesFromCoinPaprika("ar-arweave", "1M", fetchImpl);
    expect(series).toEqual([
      { timestamp: new Date("2024-01-01T00:00:00Z").getTime(), usd: 9 },
      { timestamp: new Date("2024-01-02T00:00:00Z").getTime(), usd: 11 },
    ]);
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(null, false, 500);
    await expect(
      getHistoricalUsdPricesFromCoinPaprika("ar-arweave", "ALL", fetchImpl),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("getHistoricalUsdPricesWithFallback", () => {
  it("returns the CoinGecko series when it succeeds", async () => {
    const fetchImpl = fakeFetch({ prices: [[1000, 5]] });
    const series = await getHistoricalUsdPricesWithFallback(
      { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
      "24H",
      fetchImpl,
    );
    expect(series).toEqual([{ timestamp: 1000, usd: 5 }]);
  });

  it("falls back to CoinPaprika when CoinGecko fails", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 500, json: async () => null } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => [{ timestamp: "2024-01-01T00:00:00Z", price: 3.5 }],
      } as Response;
    }) as unknown as typeof fetch;

    const series = await getHistoricalUsdPricesWithFallback(
      { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
      "7D",
      fetchImpl,
    );
    expect(series).toEqual([{ timestamp: new Date("2024-01-01T00:00:00Z").getTime(), usd: 3.5 }]);
  });

  it("returns an empty series (never throws) when both sources fail", async () => {
    const fetchImpl = fakeFetch(null, false, 500);
    const series = await getHistoricalUsdPricesWithFallback(
      { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
      "1Y",
      fetchImpl,
    );
    expect(series).toEqual([]);
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

  it("returns 0 for a timestamp before the series starts or an empty series", () => {
    const priceAt = buildPriceAtFromSeries([{ timestamp: 2000, usd: 20 }]);
    expect(priceAt(500)).toBe(0);

    const emptyPriceAt = buildPriceAtFromSeries([]);
    expect(emptyPriceAt(1000)).toBe(0);
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
