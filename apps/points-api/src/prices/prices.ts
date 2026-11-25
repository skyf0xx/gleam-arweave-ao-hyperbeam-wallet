import { isFiatCurrency, type FiatCurrency } from "@gleam/core/src/models/display.ts";
import { DEFAULT_TOKEN_REGISTRY, type HistoricalPricePoint, type HistoricalRange } from "@gleam/core/src/pricing/index.ts";
import type { PriceStore } from "./price-store";

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const COINPAPRIKA_BASE_URL = "https://api.coinpaprika.com/v1";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * CoinGecko's demo plan allows 10,000 calls a month. Each cache key
 * refreshes at most once per TTL however many clients ask, so a month
 * costs at most: spot 4,320 (one call for every id), history
 * 2 ids × (1,440 + 360 + 120 + 30) = 3,900, FX 120. About 8,300.
 */
const SPOT_TTL_MS = 10 * MINUTE_MS;
const HISTORY_TTL_MS: Record<number, number> = { 1: 30 * MINUTE_MS, 7: 2 * HOUR_MS, 30: 6 * HOUR_MS, 365: 24 * HOUR_MS };
const FX_TTL_MS = 6 * HOUR_MS;
/** A failed lookup is retried after this long, so an outage isn't hammered once per client. */
const FAILURE_TTL_MS = MINUTE_MS;
/** After any CoinGecko failure (a spent quota answers 429), CoinPaprika answers alone for this long. */
const COINGECKO_COOLDOWN_MS = 15 * MINUTE_MS;
/** A failed refresh keeps serving the last good answer for up to this long. */
const MAX_STALE_MS = 24 * HOUR_MS;
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
  /** Units of `currency` per US dollar; null when neither source could supply it. */
  fx(currency: FiatCurrency): Promise<number | null>;
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

export function parseFxQuery(query: Record<string, string | undefined>): FiatCurrency | null {
  return isFiatCurrency(query.currency) ? query.currency : null;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export interface PriceServiceOptions {
  /** Without one, CoinGecko is never called and CoinPaprika answers alone. */
  coinGeckoApiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Keeps the last good answers across restarts; without one they live in memory only. */
  store?: PriceStore;
}

const SPOT_IDS = [...PAPRIKA_ID_BY_GECKO_ID.keys()];

/**
 * Looks prices up at CoinGecko, then CoinPaprika, behind a cache. Keys are
 * bounded by the registry (ids × ranges, currencies), so the maps can't
 * grow from client input.
 */
export function createPriceService(options: PriceServiceOptions = {}): PriceService {
  const fetchImpl: typeof fetch =
    options.fetchImpl ?? ((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }));
  const now = options.now ?? Date.now;
  const coinGeckoApiKey = options.coinGeckoApiKey;
  const entries = new Map<string, Entry>();
  const lastGood = new Map<string, { value: unknown; at: number }>();
  const inFlight = new Map<string, Promise<unknown>>();
  let coinGeckoPausedUntil = 0;
  const store = options.store;

  // A store that can't be read leaves the cache empty, as on a first boot.
  const restored: Promise<void> = (store?.load() ?? Promise.resolve([]))
    .then((rows) => {
      for (const row of rows) {
        lastGood.set(row.key, { value: row.value, at: row.fetchedAt });
        entries.set(row.key, { value: row.value, expiresAt: row.expiresAt });
      }
    })
    .catch((error: unknown) => console.warn("Couldn't restore the price cache:", error));

  // Concurrent misses for one key share a single upstream round trip. An
  // empty answer is retried sooner, and is replaced by the last good one
  // (`fillFromStale` decides how) while that is recent enough.
  function cached<T>(
    key: string,
    ttlMs: number,
    isEmpty: (value: T) => boolean,
    load: () => Promise<T>,
    fillFromStale: (fresh: T, stale: T) => T = (_fresh, stale) => stale,
  ): Promise<T> {
    return restored.then(() => lookup(key, ttlMs, isEmpty, load, fillFromStale));
  }

  function lookup<T>(
    key: string,
    ttlMs: number,
    isEmpty: (value: T) => boolean,
    load: () => Promise<T>,
    fillFromStale: (fresh: T, stale: T) => T,
  ): Promise<T> {
    const hit = entries.get(key);
    if (hit && now() < hit.expiresAt) return Promise.resolve(hit.value as T);

    const pending = inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const request = load()
      .then((fresh) => {
        let value = fresh;
        if (isEmpty(fresh)) {
          const good = lastGood.get(key);
          if (good && now() - good.at < MAX_STALE_MS) value = fillFromStale(fresh, good.value as T);
        } else {
          lastGood.set(key, { value: fresh, at: now() });
          store
            ?.save({ key, value: fresh, fetchedAt: now(), expiresAt: now() + ttlMs })
            .catch((error: unknown) => console.warn(`Couldn't save the price cache entry ${key}:`, error));
        }
        entries.set(key, { value, expiresAt: now() + (isEmpty(fresh) ? FAILURE_TTL_MS : ttlMs) });
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
    const response = await fetchImpl(url, headers ? { headers } : undefined);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  // The key goes in a header so it stays out of URLs that get logged.
  async function coinGecko(path: string): Promise<unknown> {
    if (!coinGeckoApiKey || now() < coinGeckoPausedUntil) throw new Error("CoinGecko is not in use.");
    try {
      return await getJson(`${COINGECKO_BASE_URL}${path}`, { "x-cg-demo-api-key": coinGeckoApiKey });
    } catch (error) {
      coinGeckoPausedUntil = now() + COINGECKO_COOLDOWN_MS;
      throw error;
    }
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

  async function geckoSpot(): Promise<Record<string, number | null>> {
    const body = (await coinGecko(`/simple/price?ids=${SPOT_IDS.map(encodeURIComponent).join(",")}&vs_currencies=usd`)) as Record<
      string,
      { usd?: unknown }
    > | null;
    return Object.fromEntries(SPOT_IDS.map((id) => [id, typeof body?.[id]?.usd === "number" ? body[id].usd : null]));
  }

  async function paprikaSpot(id: string): Promise<number | null> {
    const body = (await getJson(`${COINPAPRIKA_BASE_URL}/tickers/${encodeURIComponent(PAPRIKA_ID_BY_GECKO_ID.get(id)!)}`)) as {
      quotes?: { USD?: { price?: unknown } };
    } | null;
    const usd = body?.quotes?.USD?.price;
    return typeof usd === "number" ? usd : null;
  }

  async function loadSpot(): Promise<Record<string, number | null>> {
    const prices: Record<string, number | null> = await geckoSpot().catch(() => ({}));
    await Promise.all(
      SPOT_IDS.filter((id) => typeof prices[id] !== "number").map(async (id) => {
        prices[id] = await paprikaSpot(id).catch(() => null);
      }),
    );
    return prices;
  }

  async function geckoHistory(id: string, range: HistoricalRange): Promise<HistoricalPricePoint[]> {
    const body = (await coinGecko(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${geckoDays(range)}`)) as {
      prices?: unknown;
    } | null;
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

  // One CoinGecko call returns BTC quotes in every currency, so the table is
  // cached once for all of them.
  function geckoRates(): Promise<Record<string, { value?: unknown }> | null> {
    return cached("fx-rates", FX_TTL_MS, (value) => value === null, async () => {
      const body = (await coinGecko("/exchange_rates").catch(() => null)) as { rates?: Record<string, { value?: unknown }> } | null;
      return body?.rates ?? null;
    });
  }

  // Both providers quote fiat against BTC, so the USD rate is the ratio of two BTC quotes.
  async function geckoFx(currency: FiatCurrency): Promise<number | null> {
    const rates = await geckoRates();
    return ratio(rates?.[currency.toLowerCase()]?.value, rates?.usd?.value);
  }

  async function paprikaFx(currency: FiatCurrency): Promise<number | null> {
    const body = (await getJson(`${COINPAPRIKA_BASE_URL}/tickers/btc-bitcoin?quotes=USD,${currency}`)) as {
      quotes?: Record<string, { price?: unknown }>;
    } | null;
    return ratio(body?.quotes?.[currency]?.price, body?.quotes?.USD?.price);
  }

  return {
    async spot(ids) {
      const all = await cached(
        "spot",
        SPOT_TTL_MS,
        (prices) => SPOT_IDS.some((id) => prices[id] === null),
        loadSpot,
        (fresh, stale) => Object.fromEntries(SPOT_IDS.map((id) => [id, fresh[id] ?? stale[id] ?? null])),
      );
      return Object.fromEntries(ids.map((id) => [id, all[id] ?? null]));
    },

    history(id, requested) {
      // ALL is served as 1Y (see `geckoDays`), so the two share one entry.
      const range = requested === "ALL" ? "1Y" : requested;
      return cached(`history:${id}:${range}`, HISTORY_TTL_MS[geckoDays(range)]!, (value) => value.length === 0, () =>
        firstSuccess<HistoricalPricePoint[]>((value) => value.length === 0, [], () => geckoHistory(id, range), () => paprikaHistory(id, range)),
      );
    },

    fx(currency) {
      if (currency === "USD") return Promise.resolve(1);
      return cached(`fx:${currency}`, FX_TTL_MS, (value) => value === null, () =>
        firstSuccess<number | null>((value) => value === null, null, () => geckoFx(currency), () => paprikaFx(currency)),
      );
    },
  };
}

function ratio(numerator: unknown, denominator: unknown): number | null {
  return typeof numerator === "number" && typeof denominator === "number" && denominator > 0 ? numerator / denominator : null;
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

/**
 * CoinPaprika doesn't bucket by range, so the interval is picked to land
 * near CoinGecko's point count. Its free plan serves hourly data only for
 * the last 24 hours and daily data only for the last 365 days, measured to
 * the second, so each start sits a few minutes inside its window: a start
 * exactly on the edge is already outside it when the request lands.
 */
function paprikaParams(range: HistoricalRange, nowMs: number): { start: string; interval: string } {
  const day = 24 * 60 * 60 * 1000;
  const margin = 5 * 60 * 1000;
  const iso = (daysBack: number) => new Date(nowMs - daysBack * day + margin).toISOString();
  switch (range) {
    case "24H":
      return { start: iso(1), interval: "1h" };
    case "7D":
      return { start: iso(7), interval: "1d" };
    case "1M":
      return { start: iso(30), interval: "1d" };
    case "1Y":
    case "ALL":
      return { start: iso(365), interval: "1d" };
  }
}
