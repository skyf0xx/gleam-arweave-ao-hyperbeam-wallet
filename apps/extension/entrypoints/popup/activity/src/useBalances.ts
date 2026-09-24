import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, TokenBalance, Winston } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

export interface WalletBalances {
  arBalance: Winston;
  tokenBalances: TokenBalance[];
}

/**
 * Shared, cached source of truth for AR + AO token balances, so
 * `SendView`'s `TokenPickerStep` and `MainScreenView` share one fetch
 * instead of each running its own. Wraps the existing
 * `runtime.send` `getBalance`/`getTokenBalances` calls as queryFns.
 *
 * Keyed by `[address, 'balances']` (`walletQueryKeys.balances`) so
 * `SendView` and `MainScreenView` mounted for the same wallet share one
 * in-flight request and one cache entry instead of racing independent
 * fetches.
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
