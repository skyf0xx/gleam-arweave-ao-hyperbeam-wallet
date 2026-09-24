/**
 * Fallback USD price source (CoinPaprika direct) for when CoinGecko is
 * unreachable or rate-limited. `getUsdPriceWithFallback` tries CoinGecko
 * first, then CoinPaprika, and only then reports unavailable — a price
 * this module can't compute is surfaced as `null`, never a fabricated `0`.
 */
const COINPAPRIKA_BASE_URL = "https://api.coinpaprika.com/v1";

/** CoinPaprika's own id strings (e.g. "ar-arweave"), not our tickers. */
export type CoinPaprikaId = "ar-arweave" | (string & {});

export async function getUsdPriceFromCoinPaprika(
  coinId: CoinPaprikaId,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const url = `${COINPAPRIKA_BASE_URL}/tickers/${encodeURIComponent(coinId)}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(
      `Failed to read USD price for "${coinId}" from CoinPaprika (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as { quotes?: { USD?: { price?: number } } };
  const usd = body.quotes?.USD?.price;
  return typeof usd === "number" ? usd : null;
}
