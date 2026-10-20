import { DEFAULT_TOKEN_REGISTRY, type HistoricalPricePoint, type HistoricalRange } from "@gleam/core/src/pricing/index.ts";

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
/** Public demo key — CoinGecko's free tier, not a secret. */
const COINGECKO_DEMO_API_KEY = "CG-XG6hdjK9NPY2vfPVZQbAptqY";
const COINPAPRIKA_BASE_URL = "https://api.coinpaprika.com/v1";

const SPOT_TTL_MS = 60_000;
const HISTORY_TTL_MS = 5 * 60_000;
/** A failed lookup is remembered briefly so an upstream outage isn't hammered once per client. */
const FAILURE_TTL_MS = 15_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

export const HISTORICAL_RANGES: readonly HistoricalRange[] = ["24H", "7D", "1M", "1Y", "ALL"];

/** CoinGecko id → CoinPaprika id, for every priced token in the registry. */
const PAPRIKA_ID_BY_GECKO_ID: ReadonlyMap<string, string> = new Map(
  DEFAULT_TOKEN_REGISTRY.flatMap((token) =>
    token.priceSource ? [[token.priceSource.coinGeckoId, token.priceSource.coinPaprikaId] as const] : [],
  ),
);

export interface PriceService {
  /** USD price per id; null when neither source could supply it. */
  spot(ids: readonly string[]): Promise<Record<string, number | null>>;
  /** Time-ordered series; empty when neither source could supply it. */
  history(id: string, range: HistoricalRange): Promise<HistoricalPricePoint[]>;
}

export function isKnownPriceId(id: string): boolean {
  return PAPRIKA_ID_BY_GECKO_ID.has(id);
}

/** Ids come from a fixed registry, so unknown ones are refused rather than relayed upstream. */
export function parseSpotQuery(query: Record<string, string | undefined>): string[] | null {
  const ids = [...new Set((query.ids ?? "").split(","))];
  if (ids.length === 0 || ids.length > PAPRIKA_ID_BY_GECKO_ID.size) return null;
  return ids.every(isKnownPriceId) ? ids : null;
}

export function parseHistoryQuery(query: Record<string, string | undefined>): { id: string; range: HistoricalRange } | null {
  const { id, range } = query;
  if (!id || !isKnownPriceId(id)) return null;
  return HISTORICAL_RANGES.includes(range as HistoricalRange) ? { id, range: range as HistoricalRange } : null;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface PriceServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Looks prices up at CoinGecko, then CoinPaprika, behind a short cache.
 * Keys are bounded by the registry (ids × ranges), so the maps can't grow
 * from client input.
 */
export function createPriceService(options: PriceServiceOptions = {}): PriceService {
  const fetchImpl = options.fetchImpl ?? ((input: string) => fetch(input, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }));
  const now = options.now ?? Date.now;
  const spotCache = new Map<string, Entry<number | null>>();
  const historyCache = new Map<string, Entry<HistoricalPricePoint[]>>();
  const inFlight = new Map<string, Promise<unknown>>();

  // Concurrent misses for one key share a single upstream round trip.
  function cached<T>(
    cache: Map<string, Entry<T>>,
    key: string,
    ttlMs: number,
    isEmpty: (value: T) => boolean,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() < hit.expiresAt) return Promise.resolve(hit.value);

    const pending = inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const request = load()
      .then((value) => {
        cache.set(key, { value, expiresAt: now() + (isEmpty(value) ? FAILURE_TTL_MS : ttlMs) });
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  async function getJson(url: string): Promise<unknown> {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function firstSuccess<T>(isEmpty: (value: T) => boolean, empty: T, ...sources: (() => Promise<T>)[]): Promise<T> {
    for (const source of sources) {
      try {
        const value = await source();
        if (!isEmpty(value)) return value;
      } catch {
        // try the next source
      }
    }
    return empty;
  }

  async function geckoSpot(id: string): Promise<number | null> {
    const body = (await getJson(
      `${COINGECKO_BASE_URL}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&x_cg_demo_api_key=${COINGECKO_DEMO_API_KEY}`,
    )) as Record<string, { usd?: unknown }> | null;
    const usd = body?.[id]?.usd;
    return typeof usd === "number" ? usd : null;
  }

  async function paprikaSpot(id: string): Promise<number | null> {
    const body = (await getJson(`${COINPAPRIKA_BASE_URL}/tickers/${encodeURIComponent(PAPRIKA_ID_BY_GECKO_ID.get(id)!)}`)) as {
      quotes?: { USD?: { price?: unknown } };
    } | null;
    const usd = body?.quotes?.USD?.price;
    return typeof usd === "number" ? usd : null;
  }

  async function geckoHistory(id: string, range: HistoricalRange): Promise<HistoricalPricePoint[]> {
    const body = (await getJson(
      `${COINGECKO_BASE_URL}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${geckoDays(range)}&x_cg_demo_api_key=${COINGECKO_DEMO_API_KEY}`,
    )) as { prices?: unknown } | null;
    if (!Array.isArray(body?.prices)) return [];
    return sorted(
      body.prices
        .filter((entry): entry is [number, number] => Array.isArray(entry) && typeof entry[0] === "number" && typeof entry[1] === "number")
        .map(([timestamp, usd]) => ({ timestamp, usd })),
    );
  }

  async function paprikaHistory(id: string, range: HistoricalRange): Promise<HistoricalPricePoint[]> {
    const { start, interval } = paprikaParams(range, now());
    const body = await getJson(
      `${COINPAPRIKA_BASE_URL}/tickers/${encodeURIComponent(PAPRIKA_ID_BY_GECKO_ID.get(id)!)}/historical?start=${encodeURIComponent(start)}&interval=${interval}`,
    );
    if (!Array.isArray(body)) return [];
    return sorted(
      body
        .filter((entry): entry is { timestamp: string; price: number } => typeof entry?.timestamp === "string" && typeof entry?.price === "number")
        .map((entry) => ({ timestamp: new Date(entry.timestamp).getTime(), usd: entry.price })),
    );
  }

  return {
    async spot(ids) {
      const entries = await Promise.all(
        ids.map(async (id) => {
          const price = await cached(spotCache, id, SPOT_TTL_MS, (value) => value === null, () =>
            firstSuccess<number | null>((value) => value === null, null, () => geckoSpot(id), () => paprikaSpot(id)),
          );
          return [id, price] as const;
        }),
      );
      return Object.fromEntries(entries);
    },

    history(id, range) {
      return cached(historyCache, `${id}:${range}`, HISTORY_TTL_MS, (value) => value.length === 0, () =>
        firstSuccess<HistoricalPricePoint[]>((value) => value.length === 0, [], () => geckoHistory(id, range), () => paprikaHistory(id, range)),
      );
    },
  };
}

function sorted(points: HistoricalPricePoint[]): HistoricalPricePoint[] {
  return points.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * `ALL` is capped at 365 days: both free tiers reject anything further
 * back (CoinGecko's `days=max` 401s, CoinPaprika's older `start` 402s),
 * so `ALL` behaves like `1Y`.
 */
function geckoDays(range: HistoricalRange): number {
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

/** CoinPaprika doesn't bucket by range, so the interval is picked to land near CoinGecko's point count. */
function paprikaParams(range: HistoricalRange, nowMs: number): { start: string; interval: string } {
  const day = 24 * 60 * 60 * 1000;
  const iso = (daysBack: number) => new Date(nowMs - daysBack * day).toISOString();
  switch (range) {
    case "24H":
      return { start: iso(1), interval: "1h" };
    case "7D":
      return { start: iso(7), interval: "6h" };
    case "1M":
      return { start: iso(30), interval: "1d" };
    case "1Y":
    case "ALL":
      return { start: iso(365), interval: "1d" };
  }
}
