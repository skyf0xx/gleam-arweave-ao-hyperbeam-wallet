import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, TokenBalance, Winston } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

export interface WalletBalances {
  arBalance: Winston;
  tokenBalances: TokenBalance[];
}

/**
 * Shared, cached source of truth for AR + AO token balances — replaces
 * the duplicated `getBalance`/`getTokenBalances` `useState`/`useEffect`
 * pairs previously local to `SendView`'s `TokenPickerStep` and
 * `MainScreenView`. Both wrap the same existing `runtime.send` calls as
 * queryFns (RELEVANT RULES: "No change to the transport layer") — this
 * hook adds no new wire method.
 *
 * Keyed by `[address, 'balances']` (`walletQueryKeys.balances`) so
 * `SendView` and `MainScreenView` mounted for the same wallet share one
 * in-flight request and one cache entry instead of racing independent
 * fetches (RELEVANT RULES: "same balance without duplicate independent
 * fetches racing each other").
 */
export function useBalances(runtime: RuntimePort, address: string) {
  return useQuery({
    queryKey: walletQueryKeys.balances(address),
    queryFn: async (): Promise<WalletBalances> => {
      const [arBalance, tokenBalances] = await Promise.all([
        runtime.send<{ address: string }, Winston>({
          type: "getBalance",
          payload: { address },
        }),
        runtime.send<{ address: string }, TokenBalance[]>({
          type: "getTokenBalances",
          payload: { address },
        }),
      ]);
      return { arBalance, tokenBalances };
    },
  });
}
