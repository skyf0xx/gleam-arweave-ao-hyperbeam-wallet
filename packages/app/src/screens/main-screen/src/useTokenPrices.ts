import { useQuery } from "@tanstack/react-query";
import type { DisplayCurrency, RuntimePort, TokenPrice } from "@gleam/core";

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
  });
}
