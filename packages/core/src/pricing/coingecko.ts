/**
 * USD price lookups against CoinGecko's public API directly (External
 * infra table: "pricing = CoinGecko/CoinPaprika direct" — no server of
 * this project's own proxies the request). Used on token detail screens
 * to show a balance's approximate USD value; never used for anything a
 * signature depends on (RELEVANT RULES's Winston-string rule is about
 * on-chain amounts, not this display-only USD estimate).
 *
 * Pure: no `chrome.*`/window/document dependency, injectable `fetchImpl`.
 */
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

/** CoinGecko's own id strings, not our token tickers. */
export type CoinGeckoId = "arweave" | "ao-computer" | (string & {});

export async function getUsdPrice(
  coinId: CoinGeckoId,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const url = `${COINGECKO_BASE_URL}/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Failed to read USD price for "${coinId}" from CoinGecko (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as Record<string, { usd?: number }>;
  const usd = body[coinId]?.usd;
  return typeof usd === "number" ? usd : null;
}
