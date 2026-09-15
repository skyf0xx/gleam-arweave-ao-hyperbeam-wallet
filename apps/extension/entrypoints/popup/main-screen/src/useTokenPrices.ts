import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, TokenPrice } from "@gleam/core";

/**
 * Current spot USD price for every token `core/pricing`'s
 * `DEFAULT_TOKEN_REGISTRY` knows how to price (AR, AO today) — drives each
 * `TokenRow`'s per-row `$` value on the main screen's Tokens tab. Not
 * address-scoped (prices aren't wallet-specific), so the query key carries
 * no `address`, unlike `usePortfolioHistory`/`useBalances`.
 */
export function useTokenPrices(runtime: RuntimePort) {
  return useQuery({
    queryKey: ["tokenPrices"] as const,
    queryFn: () => runtime.send<void, TokenPrice[]>({ type: "getTokenPrices", payload: undefined }),
  });
}
