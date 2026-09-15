import type { CoinGeckoId } from "./coingecko";
import type { CoinPaprikaId } from "./coinpaprika";

/**
 * The single source of truth for every token this wallet knows how to
 * identify and price. One entry per token: `processId` is `null` for AR
 * (it isn't an AO process), and set for every AO token — `TokenBalance`
 * entries are matched against it the same way `packages/ui`'s
 * `DEFAULT_AO_TOKEN`/`DEFAULT_AR_TOKEN` identify the two default rows (that
 * module imports `DEFAULT_TOKEN_REGISTRY` from here rather than redefining
 * the AO process id itself, so it exists in exactly one place).
 *
 * `priceSource` is `null` for any token with no confirmed CoinGecko/
 * CoinPaprika listing — there is no reliable way to discover a price-
 * provider id for an arbitrary AO process at runtime (ticker collisions,
 * no guarantee of a listing at all), so an unmapped token's price is
 * "unavailable", never guessed. Add a new entry here (with real, manually
 * verified provider ids) to make a new token priced.
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

/**
 * Current spot USD price for one registered token, keyed the same way
 * `TokenBalance`/`DEFAULT_TOKEN_REGISTRY` entries are (`processId: null`
 * for AR). `usd: null` means the price couldn't be computed (both
 * providers unavailable) — never a fabricated `0`, same HONESTY contract
 * as the rest of this module.
 */
export interface TokenPrice {
  processId: string | null;
  usd: number | null;
}
