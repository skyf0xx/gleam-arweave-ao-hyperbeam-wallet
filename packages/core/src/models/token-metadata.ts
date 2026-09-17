/**
 * Metadata for an AO token discovered outside `DEFAULT_TOKEN_REGISTRY`
 * (`core/pricing/token-sources.ts`), read directly from its process-spawn
 * tags via the gateway's GraphQL endpoint
 * (`transactions(ids: [processId]) { tags }`) — no dryrun/CU round-trip.
 * Verified against process `hmW7EXCHRzfC6YAE8FKInptdS8-6BOl3fxjZfxmAOpY`
 * ("Legacy wUSDC").
 *
 * Spawn tags are immutable once a process exists, so a successfully
 * resolved `TokenMetadata` is cacheable indefinitely — no expiry/TTL
 * field, unlike `TokenPrice`/`PortfolioHistory`, which are live reads.
 * A field the spawn tags didn't carry is `null`, never a fabricated
 * default (same HONESTY contract as `TokenPrice.usd`) — the fetch/parse
 * logic that actually produces this shape belongs to a later layer
 * (`balance.ts`/`token-sources.ts`), not this one.
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
