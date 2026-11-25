/**
 * Spot USD prices, read from the Gleam server's price proxy
 * (`GET /prices`) rather than CoinGecko/CoinPaprika directly, so users
 * whose network blocks those hosts still see balances in USD. The server
 * owns the CoinGecko→CoinPaprika fallback and the caching. Never used
 * for anything a signature depends on.
 */
import { z } from "zod";
import type { TokenPriceSource } from "./token-sources";
import { readPriceJson } from "./price-json";

const spotReplySchema = z.object({ prices: z.record(z.string(), z.unknown()).optional().catch(undefined) });

export type PriceSource = Pick<TokenPriceSource, "coinGeckoId">;

/** `null` means unavailable (server or both sources failed) — never a fabricated `0`. */
export async function getUsdPrice(
  source: PriceSource,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const body = await readPriceJson(`${apiUrl}/prices?ids=${encodeURIComponent(source.coinGeckoId)}`, fetchImpl, spotReplySchema);
  const usd = body?.prices?.[source.coinGeckoId];
  return typeof usd === "number" ? usd : null;
}
