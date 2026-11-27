import type { Winston } from "../models/balance";
import { trimTrailingSlashes } from "../models/network";

const SUPPLY_TIMEOUT_MS = 10_000;

/** Serves `/total_supply`, which AR.IO gateways answer with an error page. */
const TOTAL_SUPPLY_HOST = "https://arweave.net";

/**
 * AR's total supply in Winston, from a node's `/total_supply`: the user's
 * gateway first, then arweave.net. Throws when neither answers with an
 * integer.
 */
export async function getArTotalSupply(gatewayUrl: string, fetchImpl: typeof fetch = fetch): Promise<Winston> {
  for (const host of new Set([trimTrailingSlashes(gatewayUrl), TOTAL_SUPPLY_HOST])) {
    try {
      const response = await fetchImpl(`${host}/total_supply`, { signal: AbortSignal.timeout(SUPPLY_TIMEOUT_MS) });
      const body = response.ok ? (await response.text()).trim() : "";
      if (/^\d+$/.test(body) && BigInt(body) > 0n) return body;
    } catch {
      // The next host may answer.
    }
  }
  throw new Error("No gateway answered with AR's total supply.");
}
