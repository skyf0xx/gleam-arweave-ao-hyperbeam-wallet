/**
 * Historical USD price series, read from the Gleam server's price proxy
 * (`GET /prices/history`) rather than CoinGecko/CoinPaprika directly, so
 * users whose network blocks those hosts still get a portfolio chart.
 * The server owns the CoinGecko→CoinPaprika fallback and the caching.
 */
import type { TokenPriceSource } from "./token-sources";
import { PRICES_TIMEOUT_MS } from "./timeout";

export type HistoricalRange = "24H" | "7D" | "1M" | "1Y" | "ALL";

export interface HistoricalPricePoint {
  timestamp: number;
  usd: number;
}

export type HistoricalPriceSource = Pick<TokenPriceSource, "coinGeckoId">;

/**
 * Reports an empty series (never throws) when the server or both of its
 * sources fail; an empty array means "couldn't compute", not "there is
 * no history".
 */
export async function getHistoricalUsdPrices(
  source: HistoricalPriceSource,
  range: HistoricalRange,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoricalPricePoint[]> {
  try {
    const url = `${apiUrl}/prices/history?id=${encodeURIComponent(source.coinGeckoId)}&range=${range}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PRICES_TIMEOUT_MS) });
    if (!response.ok) return [];

    const body = (await response.json()) as { series?: unknown } | null;
    if (!Array.isArray(body?.series)) return [];
    return body.series
      .filter(
        (point): point is HistoricalPricePoint =>
          typeof point?.timestamp === "number" && typeof point?.usd === "number",
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

/**
 * Builds a `priceAt` callback from a fetched series by locating the
 * nearest point at-or-before the requested timestamp. A timestamp before
 * the series starts takes the earliest price: each coin's series starts
 * at a slightly different instant, and pricing the gap at `0` dropped
 * that token from the chart's first point, inflating the period's
 * %-change by orders of magnitude. Only an empty series resolves to `0`.
 */
export function buildPriceAtFromSeries(series: HistoricalPricePoint[]): (timestamp: number) => number {
  const sorted = [...series].sort((a, b) => a.timestamp - b.timestamp);

  return (timestamp: number): number => {
    let nearest: HistoricalPricePoint | undefined;
    for (const point of sorted) {
      if (point.timestamp <= timestamp) {
        nearest = point;
      } else {
        break;
      }
    }
    return (nearest ?? sorted[0])?.usd ?? 0;
  };
}
