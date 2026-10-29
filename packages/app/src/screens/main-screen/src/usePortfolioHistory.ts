import { useQuery } from "@tanstack/react-query";
import type { DisplayCurrency, PortfolioHistory, PortfolioHistoryRange, PortfolioScope, RuntimePort } from "@gleam/core";

/**
 * Shared, cached source of truth for the main screen's portfolio-value
 * chart.
 *
 * The payload names `address`, so the response is always for the wallet
 * the key leads with even if another surface switched the active wallet;
 * leading with it keeps each wallet in a disjoint cache entry, matching
 * `walletQueryKeys`' pattern in `../../activity/src/queryKeys.ts` (kept
 * local to this file rather than added to that module). `range` is part
 * (and `scope` and `currency`) of the key so every range tab keeps its own
 * cached response and clicking back to a previously-loaded range shows it
 * instantly rather than re-fetching.
 */
/**
 * Set well above the app's `QueryClient` default of `staleTime: 0` so
 * switching back to a range already loaded this session shows it
 * instantly instead of refetching from the points API's price proxy.
 */
const PORTFOLIO_HISTORY_STALE_TIME_MS = 5 * 60 * 1000;

export function usePortfolioHistory(
  runtime: RuntimePort,
  address: string,
  range: PortfolioHistoryRange,
  scope: PortfolioScope,
  currency: DisplayCurrency | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    enabled: enabled && currency !== undefined,
    queryKey: [address, "portfolioHistory", range, scope, currency] as const,
    queryFn: () =>
      runtime.send<{ range: PortfolioHistoryRange; address: string; scope: PortfolioScope; currency: DisplayCurrency }, PortfolioHistory>({
        type: "getPortfolioHistory",
        payload: { range, address, scope, currency: currency as DisplayCurrency },
      }),
    staleTime: PORTFOLIO_HISTORY_STALE_TIME_MS,
    // Bounds how long an offline range spends retrying before
    // `NetworkErrorBanner`'s retry button takes over, rather than the
    // default `retry: 3` exponential backoff stalling one range for
    // several seconds. `retryDelay: 0` skips TanStack's default ~1s
    // backoff so the single retry fires immediately.
    retry: 1,
    retryDelay: 0,
  });
}
