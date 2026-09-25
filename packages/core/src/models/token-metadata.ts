/**
 * Metadata for an AO token discovered outside `DEFAULT_TOKEN_REGISTRY`
 * (`core/pricing/token-sources.ts`), read directly from its process-spawn
 * tags via the gateway's GraphQL endpoint — no dryrun/CU round-trip.
 *
 * Spawn tags are immutable once a process exists, so a successfully
 * resolved `TokenMetadata` is cacheable indefinitely — no expiry/TTL
 * field, unlike `TokenPrice`/`PortfolioHistory`, which are live reads.
 * A field the spawn tags didn't carry is `null`, never a fabricated
 * default.
 */
export interface TokenMetadata {
  processId: string;
  /** Integer count of decimal places the token's atomic quantity uses. `null` if the spawn tags carried no denomination. */
  denomination: number | null;
  ticker: string | null;
  name: string | null;
  description: string | null;
  /** An Arweave tx id for the token's logo image, or `null` if the spawn tags carried none. */
  logo: string | null;
  /** Atomic integer string in the token's own smallest unit, or `null` if the spawn tags carried no total-supply tag. */
  totalSupply: string | null;
}

/**
 * The `params` shape a dApp sends when calling `window.arweaveWallet`'s
 * `tokenBalance` provider-surface method. Read-only — unlike the signing
 * methods, this needs only the existing connection-approval (Grant)
 * check for the calling origin, never the signing-approval window.
 */
export interface TokenBalanceRequest {
  /** The AO token's process id (matches Wander's `tokenBalance(id)` param name). */
  id: string;
}

/**
 * Atomic integer string in the token's own smallest unit, matching
 * `TokenBalance.quantity`'s convention — deliberately narrower than
 * Wander's documented `number | string` return type, to avoid
 * reintroducing float-precision risk.
 */
export type TokenBalanceResult = string;

/**
 * The options a dApp passes to `window.arweaveWallet.userTokens`, as in
 * Wander. Balances are left out unless `fetchBalance` is `true`.
 */
export interface UserTokensOptions {
  fetchBalance?: boolean;
}

/**
 * One entry in the `userTokens` list, in Wander's shape: capitalized
 * metadata fields, and `Name`/`Ticker` omitted when the token has none.
 */
export interface UserToken {
  processId: string;
  Name?: string;
  Ticker?: string;
  Logo?: string;
  Denomination: number;
  /**
   * Present only when `fetchBalance` was set. An atomic integer string in
   * the token's smallest unit, or `null` when the balance couldn't be read.
   */
  balance?: string | null;
}

export type UserTokensResult = UserToken[];
