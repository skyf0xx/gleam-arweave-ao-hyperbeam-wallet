import type { z } from "zod";
import { PRICES_TIMEOUT_MS } from "./timeout";

/** The price server's JSON at `url` read with `schema`, or `null` for any failure, a non-2xx answer or a reply that doesn't fit: a price is display only. */
export async function readPriceJson<S extends z.ZodType>(url: string, fetchImpl: typeof fetch, schema: S): Promise<z.output<S> | null> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PRICES_TIMEOUT_MS) });
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
