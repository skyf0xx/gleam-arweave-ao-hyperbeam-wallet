/**
 * USD exchange rates, read from the Gleam server's `GET /prices/fx`
 * proxy like the spot and historical prices. Display only.
 */
import type { FiatCurrency } from "../models/display";

/** Units of `currency` per US dollar; `null` when unavailable, never a guessed `1`. */
export async function getUsdFxRate(currency: FiatCurrency, apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (currency === "USD") return 1;
  try {
    const response = await fetchImpl(`${apiUrl}/prices/fx?currency=${encodeURIComponent(currency)}`);
    if (!response.ok) return null;

    const body = (await response.json()) as { rate?: unknown } | null;
    return typeof body?.rate === "number" && body.rate > 0 ? body.rate : null;
  } catch {
    return null;
  }
}
