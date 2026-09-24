import type { CoinGeckoId } from "./coingecko";
import type { CoinPaprikaId } from "./coinpaprika";
import { queryTokenMetadata } from "../arweave/token-metadata";
import type { TokenMetadata } from "../models/token-metadata";

/**
 * The single source of truth for every token this wallet knows how to
 * identify and price. One entry per token: `processId` is `null` for AR
 * (it isn't an AO process), and set for every AO token. `packages/ui`'s
 * `DEFAULT_AO_TOKEN`/`DEFAULT_AR_TOKEN` import `DEFAULT_TOKEN_REGISTRY`
 * from here rather than redefining the AO process id, so it exists in
 * exactly one place.
 *
 * `priceSource` is `null` for any token with no confirmed CoinGecko/
 * CoinPaprika listing — there is no reliable way to discover a price-
 * provider id for an arbitrary AO process at runtime, so an unmapped
 * token's price is "unavailable", never guessed.
 */
export interface TokenPriceSource {
  coinGeckoId: CoinGeckoId;
  coinPaprikaId: CoinPaprikaId;
}

export interface RegisteredToken {
  ticker: string;
  name: string;
  /** `null` for AR; the AO process id (or another token's process id) otherwise. */
  processId: string | null;
  priceSource: TokenPriceSource | null;
}

export const DEFAULT_TOKEN_REGISTRY: readonly RegisteredToken[] = [
  {
    ticker: "AR",
    name: "Arweave",
    processId: null,
    priceSource: { coinGeckoId: "arweave", coinPaprikaId: "ar-arweave" },
  },
  {
    ticker: "AO",
    name: "AO",
    processId: "0syT13r0s0tgPmIed95bJnuSqaD29HQNN8D3ElLSrsc",
    priceSource: { coinGeckoId: "ao-computer", coinPaprikaId: "ao-ao-computer" },
  },
];

export const AR_TOKEN = DEFAULT_TOKEN_REGISTRY[0] as RegisteredToken;
export const AO_TOKEN = DEFAULT_TOKEN_REGISTRY[1] as RegisteredToken;

/** Looks up a registered token's price source by AO `processId`, or `null` if unmapped. */
export function priceSourceForProcessId(processId: string): TokenPriceSource | null {
  return DEFAULT_TOKEN_REGISTRY.find((token) => token.processId === processId)?.priceSource ?? null;
}

/** `true` if `processId` has a hardcoded entry in `DEFAULT_TOKEN_REGISTRY`. */
export function isRegisteredProcessId(processId: string): boolean {
  return DEFAULT_TOKEN_REGISTRY.some((token) => token.processId === processId);
}

/**
 * Identifies an AO token not present in `DEFAULT_TOKEN_REGISTRY` by
 * reading its process-spawn tags via the gateway's GraphQL endpoint
 * (`queryTokenMetadata`) — a fallback for tokens the registry doesn't
 * know about, with no dryrun/CU round-trip of its own.
 *
 * A registered `processId` is never looked up this way — callers should
 * check `isRegisteredProcessId`/`priceSourceForProcessId` first. On any
 * lookup failure, returns `null` rather than throwing; a caller that
 * needs to distinguish "no metadata" from "gateway error" should call
 * `queryTokenMetadata` directly instead.
 */
export async function resolveUnregisteredTokenMetadata(
  processId: string,
  gatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenMetadata | null> {
  try {
    return await queryTokenMetadata(processId, gatewayUrl, fetchImpl);
  } catch {
    return null;
  }
}

/**
 * Current spot USD price for one registered token, keyed the same way
 * `TokenBalance`/`DEFAULT_TOKEN_REGISTRY` entries are (`processId: null`
 * for AR). `usd: null` means the price couldn't be computed (both
 * providers unavailable) — never a fabricated `0`.
 */
export interface TokenPrice {
  processId: string | null;
  usd: number | null;
}
