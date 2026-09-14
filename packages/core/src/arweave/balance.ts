import type { Winston } from "../models/balance";

/**
 * Reads AR balance via the gateway's plain REST endpoint (`GET
 * {gateway}/wallet/{address}/balance`) rather than `arweave-js`'s
 * `wallets.getBalance` (which itself just wraps the same endpoint but
 * additionally runs the response through `Ar`'s winston->AR conversion
 * pipeline) — round-tripping through a float conversion is exactly what
 * RELEVANT RULES forbids ("rendered without float conversion"), so this
 * reads the endpoint directly and returns the raw Winston string
 * untouched.
 *
 * Pure: no `chrome.*`/window/document dependency, takes an explicit
 * `gatewayUrl` and an injectable `fetchImpl` (defaults to the ambient
 * `fetch`, present in both a service worker and a test runner).
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
