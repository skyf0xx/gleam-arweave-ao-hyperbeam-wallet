import { useQuery } from "@tanstack/react-query";
import type { PortfolioHistory, PortfolioHistoryRange, RuntimePort } from "@gleam/core";

/**
 * Shared, cached source of truth for the main screen's portfolio-value
 * chart.
 *
 * `getPortfolioHistory` takes only `{ range }` — no `address` in the wire
 * payload (`ReadsHandler` resolves the active wallet itself) — but the
 * query key still leads with `address` so switching the active wallet
 * reads from/invalidates a disjoint cache entry, matching
 * `walletQueryKeys`' pattern in `../../activity/src/queryKeys.ts` (kept
 * local to this file rather than added to that module). `range` is part
 * of the key so every range tab keeps its own cached response and
 * clicking back to a previously-loaded range shows it instantly rather
 * than re-fetching.
 */
/**
 * Set well above the app's `QueryClient` default of `staleTime: 0` so
 * switching range tabs doesn't refire `getHistoricalUsdPricesWithFallback`
 * for a range already fetched this session — CoinGecko's free tier
 * rate-limits aggressively, and a quick tour of all 5 tabs firing 5 fresh
 * requests back-to-back would trip the limit partway through (typically
 * on "ALL", the tab usually tried last) and then fail every *other* range
 * too, cache or not, if each tab click always went back to the network
 * regardless of a prior successful fetch.
 */
const PORTFOLIO_HISTORY_STALE_TIME_MS = 5 * 60 * 1000;

export function usePortfolioHistory(runtime: RuntimePort, address: string, range: PortfolioHistoryRange) {
  return useQuery({
    queryKey: [address, "portfolioHistory", range] as const,
    queryFn: () =>
      runtime.send<{ range: PortfolioHistoryRange }, PortfolioHistory>({
        type: "getPortfolioHistory",
        payload: { range },
      }),
    staleTime: PORTFOLIO_HISTORY_STALE_TIME_MS,
    // Bounds how long a rate-limited/offline range spends retrying before
    // `NetworkErrorBanner`'s retry button takes over, rather than the
    // default `retry: 3` exponential backoff stalling one range for
    // several seconds. `retryDelay: 0` skips TanStack's default ~1s
    // backoff so the single retry fires immediately.
    retry: 1,
    retryDelay: 0,
  });
}
