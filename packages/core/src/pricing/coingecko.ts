/**
 * USD price lookups against CoinGecko's public API directly — no server
 * of this project's own proxies the request. Used on token detail
 * screens to show a balance's approximate USD value; never used for
 * anything a signature depends on.
 */
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
/** Public demo key — CoinGecko's free tier, not a secret. */
const COINGECKO_DEMO_API_KEY = "CG-XG6hdjK9NPY2vfPVZQbAptqY";

/** CoinGecko's own id strings, not our token tickers. */
export type CoinGeckoId = "arweave" | "ao-computer" | (string & {});

export async function getUsdPrice(
  coinId: CoinGeckoId,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const url = `${COINGECKO_BASE_URL}/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&x_cg_demo_api_key=${COINGECKO_DEMO_API_KEY}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Failed to read USD price for "${coinId}" from CoinGecko (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as Record<string, { usd?: number }>;
  const usd = body[coinId]?.usd;
  return typeof usd === "number" ? usd : null;
}
