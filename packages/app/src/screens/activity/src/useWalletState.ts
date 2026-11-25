import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, WalletState } from "@gleam/core";

export const WALLET_STATE_QUERY_KEY = ["wallets", "state"] as const;
/** Under `WALLET_STATE_QUERY_KEY`, so invalidating that refreshes it too. */
export const OPENED_WALLET_STATE_QUERY_KEY = [...WALLET_STATE_QUERY_KEY, "opened"] as const;

/**
 * `getState` as a query. A refetch on window focus or reconnect isn't the
 * user using the wallet, so the read doesn't record activity and push back
 * auto-lock. `recordActivity` is for a screen the user just opened, whose
 * first read counts as using the wallet.
 */
export function walletStateQuery(runtime: RuntimePort, recordActivity = false) {
  return recordActivity
    ? {
        queryKey: OPENED_WALLET_STATE_QUERY_KEY,
        queryFn: () => runtime.send<void, WalletState>({ type: "getState", payload: undefined }),
      }
    : {
        queryKey: WALLET_STATE_QUERY_KEY,
        queryFn: () =>
          runtime.send<{ recordActivity: boolean }, WalletState>({ type: "getState", payload: { recordActivity: false } }),
      };
}

export function useWalletState(
  runtime: RuntimePort,
  options: { placeholderData?: WalletState; refetchInterval?: number; recordActivity?: boolean } = {},
) {
  const { recordActivity, ...queryOptions } = options;
  return useQuery({ ...walletStateQuery(runtime, recordActivity), ...queryOptions });
}
