/**
 * USD exchange rates, read from the Gleam server's `GET /prices/fx`
 * proxy like the spot and historical prices. Display only.
 */
import { z } from "zod";
import type { FiatCurrency } from "../models/display";
import { readPriceJson } from "./price-json";

const fxReplySchema = z.object({ rate: z.number().positive().optional().catch(undefined) });

/** Units of `currency` per US dollar; `null` when unavailable, never a guessed `1`. */
export async function getUsdFxRate(currency: FiatCurrency, apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (currency === "USD") return 1;
  const body = await readPriceJson(`${apiUrl}/prices/fx?currency=${encodeURIComponent(currency)}`, fetchImpl, fxReplySchema);
  return body?.rate ?? null;
}
