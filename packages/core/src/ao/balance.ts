import type { TokenBalance } from "../models/balance";
import type { TokenTransport } from "../models/token-metadata";
import { readLegacyTokenBalance } from "./legacy-token";
import { AO_LEGACY_CU_URL } from "./result";

/** Matches `token-state.ts`: a busy HyperBEAM node can hold a compute read open indefinitely. */
const COMPUTE_TIMEOUT_MS = 8_000;

/**
 * Reads an AO token balance via the HyperBEAM `process@1.0` compute path:
 * `GET /{processId}~process@1.0/compute/balances/{address}`.
 *
 * HyperBEAM answers 404 for an address the token has never credited, which
 * is every fresh wallet, so that's a balance of 0. A process that doesn't
 * exist answers 500 instead, and still fails.
 */
export async function getTokenBalance(
  processId: string,
  address: string,
  peerUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenBalance> {
  const url = `${trimTrailingSlash(peerUrl)}/${processId}~process@1.0/compute/balances/${address}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(COMPUTE_TIMEOUT_MS) });

  if (response.status === 404) {
    return parseBalanceResponse("0", processId, address);
  }

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

  if (typeof body === "number" && Number.isSafeInteger(body) && body >= 0) {
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
        : typeof rawQuantity === "number" && Number.isSafeInteger(rawQuantity) && rawQuantity >= 0
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

export interface ReadTokenBalanceOptions {
  processId: string;
  address: string;
  transport: TokenTransport;
  gatewayUrl: string;
  /** The user's active HyperBEAM peer, or `null` when none is configured. */
  peerUrl: string | null;
  cuUrl?: string;
  fetchImpl?: typeof fetch;
  /** Names the token in the error, e.g. its ticker. */
  label?: string;
}

/**
 * The atomic balance of `address` on `processId`, read where that kind of
 * token actually lives:
 *
 * - `"l1"` (`arweave-scheduler@1.0`): the gateway's HyperBEAM node first,
 *   then the peer. Legacy-AO peers such as state.forward.computer answer
 *   403 or 500 for these processes.
 * - `"mu"` (legacynet): the peer's compute path first, then a CU
 *   `dry-run`. state.forward.computer serves only an allowlist of legacy
 *   processes and answers 403 for the rest.
 *
 * Throws one error naming every source tried when none answers.
 */
export async function readTokenBalance(options: ReadTokenBalanceOptions): Promise<string> {
  const { processId, address, transport, gatewayUrl, peerUrl } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const hosts = [
    ...new Set(
      (transport === "l1" ? [gatewayUrl, peerUrl] : [peerUrl])
        .filter((url): url is string => url !== null)
        .map(trimTrailingSlash),
    ),
  ];
  const failures: string[] = [];
  for (const host of hosts) {
    try {
      return (await getTokenBalance(processId, address, host, fetchImpl)).quantity;
    } catch (error) {
      failures.push(`${hostOf(host)} (${shortReason(error)})`);
    }
  }
  if (transport === "mu") {
    const cuUrl = options.cuUrl ?? AO_LEGACY_CU_URL;
    try {
      return await readLegacyTokenBalance(processId, address, cuUrl, fetchImpl);
    } catch (error) {
      failures.push(`${hostOf(cuUrl)} (${shortReason(error)})`);
    }
  }
  const label = options.label ?? "token";
  throw new Error(
    `Couldn't read your ${label} balance. Tried ${failures.join(", ")}. The token's node may be busy, so try again in a minute.`,
  );
}

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = /HTTP (\d{3})|answered (\d{3})/.exec(message);
  if (status) return `HTTP ${status[1] ?? status[2]}`;
  if (/timed? ?out|abort/i.test(message)) return "timed out";
  return "unreadable answer";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
