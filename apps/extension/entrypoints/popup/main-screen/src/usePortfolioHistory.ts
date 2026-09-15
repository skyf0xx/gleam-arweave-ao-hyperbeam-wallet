import { useQuery } from "@tanstack/react-query";
import type { PortfolioHistory, PortfolioHistoryRange, RuntimePort } from "@gleam/core";

/**
 * Shared, cached source of truth for the main screen's portfolio-value
 * chart — replaces the `useState`/`useEffect`/`runtime.send` fetch this
 * component previously ran on its own for `getPortfolioHistory`, the last
 * ad-hoc fetch on this screen after `useBalances`/`useActivity` (this
 * intent's WALLET-STATE-TANSTACK goal) took over balances/activity.
 *
 * `getPortfolioHistory` takes only `{ range }` — no `address` in the
 * wire payload (`ReadsHandler` resolves the active wallet itself) — but
 * the query key still leads with `address` so switching the active
 * wallet reads from/invalidates a disjoint cache entry, matching
 * `walletQueryKeys`' pattern in `../../activity/src/queryKeys.ts` (kept
 * local to this file rather than added to that module, which is outside
 * this layer's ALLOWED SCOPE). `range` is part of the key (not a
 * `useState` cache invalidated some other way) so every range tab keeps
 * its own cached response and clicking back to a previously-loaded range
 * shows it instantly rather than re-fetching.
 */
export function usePortfolioHistory(runtime: RuntimePort, address: string, range: PortfolioHistoryRange) {
  return useQuery({
    queryKey: [address, "portfolioHistory", range] as const,
    queryFn: () =>
      runtime.send<{ range: PortfolioHistoryRange }, PortfolioHistory>({
        type: "getPortfolioHistory",
        payload: { range },
      }),
  });
}
