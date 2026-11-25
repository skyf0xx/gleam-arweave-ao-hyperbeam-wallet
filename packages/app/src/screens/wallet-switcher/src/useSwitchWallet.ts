import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RuntimePort, WalletState } from "@gleam/core";
import { OPENED_WALLET_STATE_QUERY_KEY, WALLET_STATE_QUERY_KEY } from "../../activity";

/**
 * Makes `walletId` the active wallet. The cached wallet state takes the
 * new id at once, so screens reading it don't show the old wallet until
 * their next fetch.
 */
export function useSwitchWallet(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (walletId: string) => runtime.send<{ walletId: string }, void>({ type: "switchWallet", payload: { walletId } }),
    onSuccess: (_, walletId) => {
      for (const key of [WALLET_STATE_QUERY_KEY, OPENED_WALLET_STATE_QUERY_KEY]) {
        queryClient.setQueryData<WalletState>(key, (state) => (state ? { ...state, activeWalletId: walletId } : state));
      }
    },
  });
}
