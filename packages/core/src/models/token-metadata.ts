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

/**
 * The `params` shape a dApp sends when calling `window.arweaveWallet`'s
 * `tokenBalance` provider-surface method (`messaging/page-protocol.ts`'s
 * `PROVIDER_SURFACE_METHODS`). Read-only — unlike the signing methods, this
 * method needs only the existing connection-approval (Grant) check for the
 * calling origin, never the signing-approval window, per this task's
 * RELEVANT RULES.
 *
 * This layer only pins the request/response shape — resolving the balance
 * via the existing AO balance path (`TokenBalance.quantity`,
 * `core/models/balance.ts`) for the connected wallet's active address is
 * `provider-bridge`'s job.
 */
export interface TokenBalanceRequest {
  /** The AO token's process id (matches Wander's `tokenBalance(id)` param name). */
  id: string;
}

/**
 * Atomic integer string in the token's own smallest unit, matching
 * `TokenBalance.quantity`'s convention (never a float, to avoid precision
 * loss) — the same convention `getBalance`/`Winston` already use for the AR
 * path. Wander's own real-world return type is documented as
 * `Promise<number | string>`, but this codebase's existing AO balance path
 * (`core/models/balance.ts`'s `TokenBalance.quantity`) always carries the
 * atomic quantity as a `string`, so the wire contract here is pinned to
 * `string` only — narrower than Wander's own union, deliberately, per this
 * task's RELEVANT RULES instruction to follow the existing AO balance path
 * convention rather than reintroduce the float-precision risk a `number`
 * branch would allow.
 */
export type TokenBalanceResult = string;

/**
 * The `params` shape a dApp sends when calling `window.arweaveWallet`'s
 * `userTokens` provider-surface method. Cursor-based pagination, matching
 * Wander's own `{ cursor?, limit? }` shape exactly — this task's RELEVANT
 * RULES name no different pagination convention already in use elsewhere
 * in this codebase to reuse instead.
 */
export interface UserTokensOptions {
  cursor?: string;
  limit?: number;
}

/**
 * One entry in the `userTokens` discovery list. Field names match Wander's
 * own real-world `userTokens()` response shape (`Ticker`/`Name`/
 * `Denomination`/`Logo`, capitalized) rather than this codebase's internal
 * `TokenMetadata` naming (`ticker`/`name`/`denomination`/`logo`,
 * lowercased) — a deliberate wire-shape decision (see this task's final
 * report): `TokenMetadata`'s fields are nullable (unresolved spawn tags are
 * honestly represented as `null`), but Wander's shape has no nullable
 * variant for `Ticker`/`Name`/`Denomination`, so a `provider-bridge` layer
 * resolving this from a `TokenMetadata` entry with `null` fields will need
 * to decide a fallback (e.g. omitting the entry, or a placeholder) — that
 * resolution is out of this layer's scope. `Denomination` is carried as a
 * `string` here (rather than `TokenMetadata.denomination`'s `number`) to
 * match Wander's own documented shape, which strings the field like every
 * other token unit convention.
 */
export interface UserToken {
  processId: string;
  Ticker: string;
  Name: string;
  Denomination: string;
  Logo?: string;
}

export type UserTokensResult = UserToken[];
