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
 * The `params` shape a dApp sends when calling `window.arweaveWallet`'s
 * `userTokens` provider-surface method. Cursor-based pagination, matching
 * Wander's own `{ cursor?, limit? }` shape.
 */
export interface UserTokensOptions {
  cursor?: string;
  limit?: number;
}

/**
 * One entry in the `userTokens` discovery list. Field names match Wander's
 * `userTokens()` response shape (`Ticker`/`Name`/`Denomination`/`Logo`,
 * capitalized) rather than this codebase's internal `TokenMetadata`
 * naming. `TokenMetadata`'s fields are nullable, but Wander's shape has
 * no nullable variant, so a caller resolving this from a `TokenMetadata`
 * with `null` fields needs to decide a fallback.
 */
export interface UserToken {
  processId: string;
  Ticker: string;
  Name: string;
  Denomination: string;
  Logo?: string;
}

export type UserTokensResult = UserToken[];
