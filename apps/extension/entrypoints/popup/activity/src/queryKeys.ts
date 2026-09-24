/**
 * Shared TanStack Query key builders that both the query hooks and any
 * mutation invalidating them read from, so a key typo can't silently
 * desync a query from its invalidator.
 *
 * Keyed by `wallet.address` first, so switching the active wallet
 * naturally reads from/invalidates a disjoint cache entry with no extra
 * bookkeeping.
 */
export const walletQueryKeys = {
  balances: (address: string) => [address, "balances"] as const,
  activity: (address: string) => [address, "activity"] as const,
};
