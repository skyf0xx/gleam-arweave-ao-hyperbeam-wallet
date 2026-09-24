import type { Winston } from "../models/balance";

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
  const response = await fetchImpl(url);

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
