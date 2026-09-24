import type { TokenBalance } from "../models/balance";

/**
 * Reads an AO token balance via the HyperBEAM `process@1.0` compute path:
 * `GET /{processId}~process@1.0/compute/balances/{address}`.
 */
export async function getTokenBalance(
  processId: string,
  address: string,
  peerUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenBalance> {
  const url = `${trimTrailingSlash(peerUrl)}/${processId}~process@1.0/compute/balances/${address}`;
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(
      `Failed to read AO token balance for "${address}" on process "${processId}" from ${peerUrl} (HTTP ${response.status}).`,
    );
  }

  const body = await response.json();
  return parseBalanceResponse(body, processId, address);
}

/**
 * This parser accepts two response shapes (a bare quantity string/number,
 * or an object carrying `balance`/`ticker`/`denomination`) and fails
 * loudly on anything else rather than guessing.
 *
 * `compute/balances/{address}` against a live HyperBEAM node
 * (state.forward.computer) returns a bare atomic quantity string with no
 * denomination field, and `now/denomination` isn't reachable to look it
 * up separately. The bare-quantity shapes are only ever returned for the
 * AO token in practice, so they default to AO's known denomination (12)
 * rather than 0 — defaulting to 0 rendered every balance as an undivided
 * atomic integer (e.g. "500100000000" instead of "0.5001").
 */
const AO_TOKEN_DENOMINATION = 12;

function parseBalanceResponse(
  body: unknown,
  processId: string,
  address: string,
): TokenBalance {
  if (typeof body === "string" && /^\d+$/.test(body)) {
    return {
      address,
      processId,
      ticker: processId,
      denomination: AO_TOKEN_DENOMINATION,
      name: null,
      quantity: body,
    };
  }

  if (typeof body === "number" && Number.isInteger(body)) {
    return {
      address,
      processId,
      ticker: processId,
      denomination: AO_TOKEN_DENOMINATION,
      name: null,
      quantity: String(body),
    };
  }

  if (body !== null && typeof body === "object") {
    const candidate = body as Record<string, unknown>;
    const rawQuantity = candidate.balance ?? candidate.quantity;
    const quantity =
      typeof rawQuantity === "string"
        ? rawQuantity
        : typeof rawQuantity === "number"
          ? String(rawQuantity)
          : undefined;

    if (quantity !== undefined && /^\d+$/.test(quantity)) {
      return {
        address,
        processId,
        ticker: typeof candidate.ticker === "string" ? candidate.ticker : processId,
        denomination:
          typeof candidate.denomination === "number"
            ? candidate.denomination
            : AO_TOKEN_DENOMINATION,
        name: typeof candidate.name === "string" ? candidate.name : null,
        quantity,
      };
    }
  }

  throw new Error(
    `Unrecognized AO balance response shape for process "${processId}", address "${address}": ${JSON.stringify(body)}`,
  );
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
