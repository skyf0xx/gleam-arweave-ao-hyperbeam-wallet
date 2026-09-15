/**
 * Shared TanStack Query key builders — the single source of truth both
 * `useBalances`/`useActivity` (this module) and any mutation that needs
 * to invalidate them (`useSendMutation`, this module) read from, so a
 * key typo can't silently desync a query from its invalidator.
 *
 * Keyed by `wallet.address` first (per RELEVANT RULES: "multiple wallets
 * don't collide in cache") — switching the active wallet naturally reads
 * from/invalidates a disjoint cache entry with no extra bookkeeping.
 */
export const walletQueryKeys = {
  balances: (address: string) => [address, "balances"] as const,
  activity: (address: string) => [address, "activity"] as const,
};
