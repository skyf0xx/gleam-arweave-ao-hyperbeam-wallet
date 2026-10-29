import type { Winston } from "../models/balance";

/** A gateway that never answers would otherwise hold every balance read open. */
const BALANCE_TIMEOUT_MS = 10_000;

/**
 * Reads via the gateway's plain REST endpoint rather than `arweave-js`'s
 * `wallets.getBalance`, which round-trips the response through a
 * winston->AR float conversion — this returns the raw Winston string
 * untouched to avoid that precision loss.
 */
export async function getBalance(
  address: string,
  gatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Winston> {
  const url = `${trimTrailingSlash(gatewayUrl)}/wallet/${address}/balance`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(
      `Failed to read AR balance for "${address}" from ${gatewayUrl} (HTTP ${response.status}).`,
    );
  }

  const body = (await response.text()).trim();
  if (!/^\d+$/.test(body)) {
    throw new Error(
      `Gateway returned a non-integer balance for "${address}": "${body}".`,
    );
  }

  return body;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
