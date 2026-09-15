import { getUsdPrice, type CoinGeckoId } from "./coingecko";
import { getUsdPriceFromCoinPaprika, type CoinPaprikaId } from "./coinpaprika";

export { getUsdPrice, type CoinGeckoId } from "./coingecko";
export { getUsdPriceFromCoinPaprika, type CoinPaprikaId } from "./coinpaprika";
export {
  getHistoricalUsdPrices,
  getHistoricalUsdPricesFromCoinPaprika,
  getHistoricalUsdPricesWithFallback,
  buildPriceAtFromSeries,
  type HistoricalRange,
  type HistoricalPricePoint,
  type HistoricalPriceSource,
} from "./historical";
export {
  estimateHistoricalPortfolioValue,
  type PricedHistoricalToken,
} from "./portfolio";
export {
  DEFAULT_TOKEN_REGISTRY,
  AR_TOKEN,
  AO_TOKEN,
  priceSourceForProcessId,
  type RegisteredToken,
  type TokenPriceSource,
  type TokenPrice,
} from "./token-sources";

export interface PriceSource {
  coinGeckoId: CoinGeckoId;
  coinPaprikaId: CoinPaprikaId;
}

/**
 * Tries CoinGecko, falls back to CoinPaprika on any failure (network
 * error, rate limit, unrecognized id), and only then reports `null` —
 * never a fabricated `0` for a price this module couldn't compute
 * (HONESTY: "a value you can't compute is surfaced as unavailable rather
 * than as 0 or a plausible default").
 */
export async function getUsdPriceWithFallback(
  source: PriceSource,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const price = await getUsdPrice(source.coinGeckoId, fetchImpl);
    if (price !== null) return price;
  } catch {
    // fall through to CoinPaprika
  }

  try {
    return await getUsdPriceFromCoinPaprika(source.coinPaprikaId, fetchImpl);
  } catch {
    return null;
  }
}
