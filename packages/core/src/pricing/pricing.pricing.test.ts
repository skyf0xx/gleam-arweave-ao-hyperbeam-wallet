import { describe, expect, it, vi } from "vitest";
import { getUsdPrice } from "./coingecko";
import { getUsdPriceFromCoinPaprika } from "./coinpaprika";
import { getUsdPriceWithFallback } from "./index";

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("getUsdPrice (CoinGecko)", () => {
  it("returns the usd price for the given coin id", async () => {
    const fetchImpl = fakeFetch({ arweave: { usd: 11.23 } });
    const price = await getUsdPrice("arweave", fetchImpl);
    expect(price).toBe(11.23);
  });

  it("returns null when the coin id is absent from the response", async () => {
    const fetchImpl = fakeFetch({});
    const price = await getUsdPrice("arweave", fetchImpl);
    expect(price).toBeNull();
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(null, false, 429);
    await expect(getUsdPrice("arweave", fetchImpl)).rejects.toThrow(/HTTP 429/);
  });
});

describe("getUsdPriceFromCoinPaprika", () => {
  it("returns the usd price from the tickers response", async () => {
    const fetchImpl = fakeFetch({ quotes: { USD: { price: 11.5 } } });
    const price = await getUsdPriceFromCoinPaprika("ar-arweave", fetchImpl);
    expect(price).toBe(11.5);
  });

  it("returns null when the price is missing", async () => {
    const fetchImpl = fakeFetch({ quotes: {} });
    const price = await getUsdPriceFromCoinPaprika("ar-arweave", fetchImpl);
    expect(price).toBeNull();
  });
});

describe("getUsdPriceWithFallback", () => {
  it("returns the CoinGecko price when it succeeds", async () => {
    const fetchImpl = fakeFetch({ arweave: { usd: 9.99 } });
    const price = await getUsdPriceWithFallback(
      { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
      fetchImpl,
    );
    expect(price).toBe(9.99);
  });

  it("falls back to CoinPaprika when CoinGecko fails", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 500, json: async () => null } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ quotes: { USD: { price: 7.77 } } }) } as Response;
    }) as unknown as typeof fetch;

    const price = await getUsdPriceWithFallback(
      { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
      fetchImpl,
    );
    expect(price).toBe(7.77);
  });

  it("reports unavailable (null) rather than a fabricated 0 when both sources fail", async () => {
    const fetchImpl = fakeFetch(null, false, 500);
    const price = await getUsdPriceWithFallback(
      { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
      fetchImpl,
    );
    expect(price).toBeNull();
  });
});
