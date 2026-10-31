import { useQuery } from "@tanstack/react-query";
import type { PendingAmounts, PendingTransfer, RuntimePort, TokenBalance, Winston } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

/** An incoming transfer sends the wallet no signal, so an open popup or side panel has to ask. */
const BALANCES_POLL_MS = 60_000;

export interface WalletBalances {
  /** What can be spent: the chain's balance less pending sends, as is every `quantity` here. */
  arBalance: Winston;
  arPending?: PendingAmounts;
  tokenBalances: TokenBalance[];
}

function spendable(quantity: string, pending: PendingAmounts): string {
  const left = BigInt(quantity) - BigInt(pending.outgoing);
  return (left > 0n ? left : 0n).toString();
}

function withPending(arBalance: Winston, tokenBalances: TokenBalance[], pending: PendingTransfer[]): WalletBalances {
  const ofToken = new Map(pending.map(({ token, outgoing, incoming }) => [token, { outgoing, incoming }]));
  const ar = ofToken.get(null);
  return {
    arBalance: ar ? spendable(arBalance, ar) : arBalance,
    ...(ar ? { arPending: ar } : {}),
    tokenBalances: tokenBalances.map((balance) => {
      const amounts = ofToken.get(balance.processId);
      if (!amounts || balance.available === false) return balance;
      return { ...balance, quantity: spendable(balance.quantity, amounts), pending: amounts };
    }),
  };
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
export function balancesQuery(runtime: RuntimePort, address: string) {
  return {
    queryKey: walletQueryKeys.balances(address),
    queryFn: async (): Promise<WalletBalances> => {
      const [arBalance, tokenBalances, pending] = await Promise.all([
        runtime.send<{ address: string }, Winston>({
          type: "getBalance",
          payload: { address },
        }),
        runtime.send<{ address: string }, TokenBalance[]>({
          type: "getTokenBalances",
          payload: { address },
        }),
        // Extra detail; balances still show without it.
        (async () => runtime.send<{ address: string }, PendingTransfer[]>({ type: "getPendingTransfers", payload: { address } }))().catch(
          () => [],
        ),
      ]);
      return withPending(arBalance, tokenBalances, pending ?? []);
    },
  };
}

export function useBalances(runtime: RuntimePort, address: string) {
  return useQuery({ ...balancesQuery(runtime, address), refetchInterval: BALANCES_POLL_MS });
}
