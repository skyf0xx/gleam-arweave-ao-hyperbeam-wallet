import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, WalletState } from "@gleam/core";

export const WALLET_STATE_QUERY_KEY = ["wallets", "state"] as const;

/**
 * `getState` as a query. A refetch on window focus or reconnect isn't the
 * user using the wallet, so the read doesn't record activity and push back
 * auto-lock.
 */
export function walletStateQuery(runtime: RuntimePort) {
  return {
    queryKey: WALLET_STATE_QUERY_KEY,
    queryFn: () =>
      runtime.send<{ recordActivity: boolean }, WalletState>({ type: "getState", payload: { recordActivity: false } }),
  };
}

export function useWalletState(runtime: RuntimePort, options: { placeholderData?: WalletState; refetchInterval?: number } = {}) {
  return useQuery({ ...walletStateQuery(runtime), ...options });
}
