import { useQuery } from "@tanstack/react-query";
import type { DisplayCurrency, RuntimePort, TokenPrice } from "@gleam/core";
import { HOME_READ_STALE_MS, retryWhileFailed } from "../../../query-cache/retry";

/**
 * Current spot price, in the display currency, for every token
 * `core/pricing`'s `DEFAULT_TOKEN_REGISTRY` knows how to price (AR, AO
 * today) — drives each `TokenRow`'s value line on the main screen's Tokens
 * tab. Not address-scoped (prices aren't wallet-specific), so the query key
 * carries no `address`, unlike `usePortfolioHistory`/`useBalances`. Waits
 * for the currency, so it never fetches one only to throw it away.
 */
export function useTokenPrices(runtime: RuntimePort, currency: DisplayCurrency | undefined) {
  return useQuery({
    enabled: currency !== undefined,
    queryKey: ["tokenPrices", currency] as const,
    queryFn: () =>
      runtime.send<{ currency: DisplayCurrency }, TokenPrice[]>({
        type: "getTokenPrices",
        payload: { currency: currency as DisplayCurrency },
      }),
    staleTime: HOME_READ_STALE_MS,
    refetchInterval: retryWhileFailed,
  });
}

/** A token the node couldn't price is asked again this often while the screen is open. */
const UNPRICED_RETRY_MS = 2 * 60_000;

/**
 * Prices for tokens outside the registry, read from each token's own
 * orderbook. A separate query from `useTokenPrices` so a slow or down node
 * never holds back the AR and AO prices. A token it can't price is simply
 * absent and re-asked quietly; nothing is surfaced to the user.
 */
export function useOrderbookPrices(runtime: RuntimePort, currency: DisplayCurrency | undefined, processIds: string[]) {
  return useQuery({
    enabled: currency !== undefined && processIds.length > 0,
    queryKey: ["orderbookPrices", currency, processIds] as const,
    queryFn: async () => {
      const prices = await runtime.send<{ currency: DisplayCurrency; processIds: string[] }, TokenPrice[]>({
        type: "getTokenPrices",
        payload: { currency: currency as DisplayCurrency, processIds },
      });
      return prices.filter((entry) => entry.processId !== null && processIds.includes(entry.processId));
    },
    refetchInterval: (query) => (query.state.data !== undefined && query.state.data.length < processIds.length ? UNPRICED_RETRY_MS : false),
  });
}
