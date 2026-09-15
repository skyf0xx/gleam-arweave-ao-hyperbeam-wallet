import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

export interface SubmitTransferVariables {
  walletId: string;
  recipient: string;
  token: string | null;
  amount: string;
  fee: string | null;
}

export interface SubmitTransferResult {
  txId: string;
}

/**
 * Wraps the existing `submitTransfer` `runtime.send` call as a mutationFn
 * (no transport-layer change) and, on success, invalidates both the
 * balances and activity queries for `address` — RELEVANT RULES: "After a
 * successful send, both Send and Main Screen reflect the updated balance
 * without a manual popup reopen." Both screens read through
 * `useBalances`/`useActivity` keyed on the same `walletQueryKeys`
 * builders, so invalidating here is sufficient; neither screen needs its
 * own invalidation call.
 *
 * `address` is the sender's own address (not the recipient) — it's the
 * wallet whose balance/activity actually changed as a result of this
 * send.
 */
export function useSubmitTransfer(runtime: RuntimePort, address: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: SubmitTransferVariables) =>
      runtime.send<SubmitTransferVariables, SubmitTransferResult>({
        type: "submitTransfer",
        payload: variables,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances(address) });
      void queryClient.invalidateQueries({ queryKey: walletQueryKeys.activity(address) });
    },
  });
}
