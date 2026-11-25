import { PRICES_TIMEOUT_MS } from "./timeout";

/** The price server's JSON at `url`, or `null` for any failure or a non-2xx answer: a price is display only. */
export async function readPriceJson<T>(url: string, fetchImpl: typeof fetch): Promise<T | null> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PRICES_TIMEOUT_MS) });
    if (!response.ok) return null;
    return (await response.json()) as T | null;
  } catch {
    return null;
  }
}
