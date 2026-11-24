import type { TokenBalance } from "../models/balance";
import { L1_TOKEN_NODE_URLS } from "../models/network";
import type { TokenTransport } from "../models/token-metadata";
import { readLegacyTokenBalance } from "./legacy-token";
import { AO_LEGACY_CU_URL } from "./result";
import { userErrorMessage } from "../models/user-errors";
import { readCappedText } from "./capped-body";

/** Matches `token-state.ts`: a busy HyperBEAM node can hold a compute read open indefinitely. */
const COMPUTE_TIMEOUT_MS = 8_000;

/**
 * Reads a legacy AO token balance via the HyperBEAM `process@1.0` compute path:
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
  return (await queryBalance(processId, address, peerUrl, fetchImpl)) ?? parseBalanceResponse("0", processId, address);
}

// A balance reply is one number, or a small object carrying it. A peer
// that sends more isn't answering, and reading it all would let any peer
// allocate unbounded memory in the worker.
const BALANCE_RESPONSE_MAX_BYTES = 64 * 1024;
const NUMBER_RESPONSE_MAX_BYTES = 4096;

/** `null` for a 404. */
async function queryBalance(
  processId: string,
  address: string,
  peerUrl: string,
  fetchImpl: typeof fetch,
): Promise<TokenBalance | null> {
  const url = `${trimTrailingSlash(peerUrl)}/${processId}~process@1.0/compute/balances/${address}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(COMPUTE_TIMEOUT_MS) });

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(
      userErrorMessage("aoBalanceFailed", { address, process: processId, peer: peerUrl, status: response.status }),
    );
  }

  const text = await readCappedText(response, BALANCE_RESPONSE_MAX_BYTES);
  return parseBalanceResponse(text === null ? null : JSON.parse(text), processId, address);
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
  /** Nodes an L1 token is read from besides the gateway; `L1_TOKEN_NODE_URLS` by default. */
  l1NodeUrls?: readonly string[];
}

/**
 * The atomic balance of `address` on `processId`, read where that kind of
 * token actually lives:
 *
 * - `"l1"` (`arweave-scheduler@1.0`): `readL1Balance`.
 * - `"mu"` (legacynet): the peer's compute path first, then a CU
 *   `dry-run`. state.forward.computer serves only an allowlist of legacy
 *   processes and answers 403 for the rest.
 *
 * Throws one error naming every source tried when none answers.
 */
export async function readTokenBalance(options: ReadTokenBalanceOptions): Promise<string> {
  const { processId, address, transport, gatewayUrl, peerUrl, label } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (transport === "l1") return readL1Balance(processId, address, gatewayUrl, peerUrl, fetchImpl, label, options.l1NodeUrls);
  const failures: string[] = [];
  if (peerUrl !== null) {
    try {
      return (await getTokenBalance(processId, address, trimTrailingSlash(peerUrl), fetchImpl)).quantity;
    } catch (error) {
      failures.push(`${hostOf(peerUrl)} (${shortReason(error)})`);
    }
  }
  const cuUrl = options.cuUrl ?? AO_LEGACY_CU_URL;
  try {
    return await readLegacyTokenBalance(processId, address, cuUrl, fetchImpl);
  } catch (error) {
    failures.push(`${hostOf(cuUrl)} (${shortReason(error)})`);
  }
  throw balanceReadError(label, failures);
}

/**
 * The balance of an `arweave-scheduler@1.0` process, from its `now/as/balance`
 * path. Tries the gateway's HyperBEAM node, then `l1NodeUrls`, then
 * the peer; legacy-AO peers such as state.forward.computer answer 403 or 500
 * for these processes. The first number wins, asking first the hosts that
 * have scheduled the most messages for the process, together: each node picks up L1
 * transfers on its own, and one that hasn't yet answers the old balance
 * with a 200. arweave.net has lagged a transfer by many blocks.
 *
 * These processes keep balances in a trie, so `compute/balances/{address}`
 * answers 404 for every address, holders included. `now/as/balance` answers
 * 0 for an address the token never credited, so a 404 here is no answer, and
 * a balance nobody can vouch for throws rather than showing a holder 0.
 *
 * The answer is parsed as text: a JSON number would lose precision on a
 * large balance, and a gateway can answer 200 with an HTML page.
 */
export async function readL1Balance(
  processId: string,
  address: string,
  gatewayUrl: string,
  peerUrl: string | null,
  fetchImpl: typeof fetch = fetch,
  label?: string,
  l1NodeUrls: readonly string[] = L1_TOKEN_NODE_URLS,
): Promise<string> {
  const groups = await furthestAheadFirst(
    processId,
    [...new Set([gatewayUrl, ...l1NodeUrls, peerUrl].filter((url): url is string => url !== null).map(trimTrailingSlash))],
    fetchImpl,
  );
  const failures: string[] = [];
  for (const hosts of groups) {
    const answer = await firstL1Answer(processId, address, hosts, fetchImpl);
    if ("quantity" in answer) return answer.quantity;
    failures.push(...answer.failures);
  }
  throw balanceReadError(label, failures);
}

/** The first number any of `hosts` answers, all asked at once, so one that hangs costs nothing while another answers. */
async function firstL1Answer(
  processId: string,
  address: string,
  hosts: string[],
  fetchImpl: typeof fetch,
): Promise<{ quantity: string } | { failures: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), COMPUTE_TIMEOUT_MS);
  const failures: string[] = [];
  const ask = async (host: string, index: number): Promise<string> => {
    let failure: string;
    try {
      const url = `${host}/${processId}~process@1.0/now/as/balance?as=execution&balance=${address}`;
      const response = await fetchImpl(url, { signal: controller.signal });
      const quantity = response.ok ? ((await readCappedText(response, NUMBER_RESPONSE_MAX_BYTES)) ?? "").trim() : "";
      if (/^\d+$/.test(quantity)) return quantity;
      failure = response.ok ? "unreadable answer" : `HTTP ${response.status}`;
    } catch (error) {
      failure = shortReason(error);
    }
    failures[index] = `${hostOf(host)} (${failure})`;
    throw new Error(failures[index]);
  };
  try {
    return { quantity: await Promise.any(hosts.map(ask)) };
  } catch {
    return { failures };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Every read waits on the slowest host's slot, so a host that hangs is
 * cut off here rather than at the balance read's own timeout.
 */
const SLOT_TIMEOUT_MS = 1_500;

/**
 * `hosts` grouped by the slot each has reached for `processId`, highest
 * first. A host that gives no slot in time goes in a group of its own after
 * those that do: how far it has got is unknown, so it never races another.
 */
async function furthestAheadFirst(processId: string, hosts: string[], fetchImpl: typeof fetch): Promise<string[][]> {
  const slots = await Promise.all(
    hosts.map(async (host) => {
      try {
        const response = await fetchImpl(`${host}/${processId}~process@1.0/slot/current`, { signal: AbortSignal.timeout(SLOT_TIMEOUT_MS) });
        const text = response.ok ? ((await readCappedText(response, NUMBER_RESPONSE_MAX_BYTES)) ?? "").trim() : "";
        return /^\d+$/.test(text) ? BigInt(text) : -1n;
      } catch {
        return -1n;
      }
    }),
  );
  const known = [...new Set(slots.filter((slot) => slot >= 0n))].sort((a, b) => (a > b ? -1 : 1));
  return [
    ...known.map((slot) => hosts.filter((_, index) => slots[index] === slot)),
    ...hosts.filter((_, index) => slots[index]! < 0n).map((host) => [host]),
  ];
}

function balanceReadError(label: string | undefined, failures: string[]): Error {
  return new Error(
    userErrorMessage("tokenBalanceUnreadable", { label: label ?? "token", failures: failures.join(", ") }),
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
