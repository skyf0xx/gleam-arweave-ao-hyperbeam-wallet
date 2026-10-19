/**
 * Spot USD prices, read from the Gleam server's price proxy
 * (`GET /prices`) rather than CoinGecko/CoinPaprika directly, so users
 * whose network blocks those hosts still see balances in USD. The server
 * owns the CoinGecko→CoinPaprika fallback and the caching. Never used
 * for anything a signature depends on.
 */
import type { TokenPriceSource } from "./token-sources";

export type PriceSource = Pick<TokenPriceSource, "coinGeckoId">;

/** `null` means unavailable (server or both sources failed) — never a fabricated `0`. */
export async function getUsdPrice(
  source: PriceSource,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(`${apiUrl}/prices?ids=${encodeURIComponent(source.coinGeckoId)}`);
    if (!response.ok) return null;

    const body = (await response.json()) as { prices?: Record<string, unknown> } | null;
    const usd = body?.prices?.[source.coinGeckoId];
    return typeof usd === "number" ? usd : null;
  } catch {
    return null;
  }
}
