/**
 * Historical USD price series against CoinGecko/CoinPaprika direct — same
 * two sources as spot price (`coingecko.ts`/`coinpaprika.ts`), used to
 * drive a portfolio-value-over-time chart rather than a single current
 * price.
 */
import type { CoinGeckoId } from "./coingecko";
import type { CoinPaprikaId } from "./coinpaprika";

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
/** Public demo key — CoinGecko's free tier, not a secret. */
const COINGECKO_DEMO_API_KEY = "CG-XG6hdjK9NPY2vfPVZQbAptqY";
const COINPAPRIKA_BASE_URL = "https://api.coinpaprika.com/v1";

export type HistoricalRange = "24H" | "7D" | "1M" | "1Y" | "ALL";

export interface HistoricalPricePoint {
  timestamp: number;
  usd: number;
}

/**
 * Range → CoinGecko `days` param and CoinPaprika `interval` param.
 *
 * CoinGecko buckets granularity automatically by `days`, so no separate
 * granularity choice is needed on that side. CoinPaprika has no such
 * auto-bucketing, so an explicit `interval` is picked to land on a
 * comparable point count: hourly for 24H, 6-hourly for 7D, daily for
 * 1M/1Y, weekly for ALL.
 *
 * `ALL` requests 365 days, not a true full-history request: both
 * free-tier APIs reject anything further back (CoinGecko's `days=max`
 * 401s past 365 days; CoinPaprika's epoch `start` 402s past its plan's
 * history window) — a real plan limit, not a request-construction bug.
 * Capping at 365 days makes `ALL` behave like `1Y` for both providers,
 * matching what the free tier can actually serve.
 */
function rangeToCoinGeckoDays(range: HistoricalRange): number {
  switch (range) {
    case "24H":
      return 1;
    case "7D":
      return 7;
    case "1M":
      return 30;
    case "1Y":
    case "ALL":
      return 365;
  }
}

function rangeToCoinPaprikaParams(range: HistoricalRange): { start: string; interval: string } {
  const now = Date.now();
  switch (range) {
    case "24H":
      return { start: new Date(now - 24 * 60 * 60 * 1000).toISOString(), interval: "1h" };
    case "7D":
      return { start: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), interval: "6h" };
    case "1M":
      return { start: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(), interval: "1d" };
    case "1Y":
    case "ALL":
      return { start: new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(), interval: "1d" };
  }
}

export async function getHistoricalUsdPrices(
  coinId: CoinGeckoId,
  range: HistoricalRange,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoricalPricePoint[]> {
  const days = rangeToCoinGeckoDays(range);
  const url = `${COINGECKO_BASE_URL}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}&x_cg_demo_api_key=${COINGECKO_DEMO_API_KEY}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(
      `Failed to read historical USD prices for "${coinId}" from CoinGecko (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as { prices?: [number, number][] };
  const prices = body.prices;
  if (!Array.isArray(prices)) return [];

  return prices
    .filter(
      (entry): entry is [number, number] =>
        Array.isArray(entry) && typeof entry[0] === "number" && typeof entry[1] === "number",
    )
    .map(([timestamp, usd]) => ({ timestamp, usd }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function getHistoricalUsdPricesFromCoinPaprika(
  coinId: CoinPaprikaId,
  range: HistoricalRange,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoricalPricePoint[]> {
  const { start, interval } = rangeToCoinPaprikaParams(range);
  const url = `${COINPAPRIKA_BASE_URL}/tickers/${encodeURIComponent(coinId)}/historical?start=${encodeURIComponent(start)}&interval=${encodeURIComponent(interval)}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(
      `Failed to read historical USD prices for "${coinId}" from CoinPaprika (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as { timestamp?: string; price?: number }[];
  if (!Array.isArray(body)) return [];

  return body
    .filter(
      (entry): entry is { timestamp: string; price: number } =>
        typeof entry?.timestamp === "string" && typeof entry?.price === "number",
    )
    .map((entry) => ({ timestamp: new Date(entry.timestamp).getTime(), usd: entry.price }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export interface HistoricalPriceSource {
  coinGeckoId: CoinGeckoId;
  coinPaprikaId: CoinPaprikaId;
}

/**
 * Tries CoinGecko, falls back to CoinPaprika on any failure, and only then
 * reports an empty series — never throws to the caller; an empty array
 * means "couldn't compute", not "there is no history".
 */
export async function getHistoricalUsdPricesWithFallback(
  source: HistoricalPriceSource,
  range: HistoricalRange,
  fetchImpl: typeof fetch = fetch,
): Promise<HistoricalPricePoint[]> {
  try {
    const series = await getHistoricalUsdPrices(source.coinGeckoId, range, fetchImpl);
    if (series.length > 0) return series;
  } catch {
    // fall through to CoinPaprika
  }

  try {
    return await getHistoricalUsdPricesFromCoinPaprika(source.coinPaprikaId, range, fetchImpl);
  } catch {
    return [];
  }
}

/**
 * Builds a `priceAt` callback from a fetched series by locating the
 * nearest point at-or-before the requested timestamp. A timestamp with
 * no covering data resolves to `0`, never a thrown error.
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
    return nearest?.usd ?? 0;
  };
}
