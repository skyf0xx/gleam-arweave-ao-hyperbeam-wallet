import type { Winston } from "../models/balance";
import { userErrorMessage } from "../models/user-errors";
import { trimTrailingSlashes } from "../models/network";

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
  const url = `${trimTrailingSlashes(gatewayUrl)}/wallet/${address}/balance`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(
      userErrorMessage("arBalanceFailed", { address, gateway: gatewayUrl, status: response.status }),
    );
  }

  const body = (await response.text()).trim();
  if (!/^\d+$/.test(body)) {
    throw new Error(
      userErrorMessage("arBalanceNotInteger", { address, body }),
    );
  }

  return body;
}
