import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Collectible, CollectibleSendDraft, RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

/**
 * Sends one collectible and, on success, drops it from the wallet's
 * collectibles at once. The background removes it from its cache too, so
 * the refetch this triggers doesn't bring it back while the asset process
 * hasn't read the transaction yet.
 */
export function useSendCollectible(runtime: RuntimePort, address: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: CollectibleSendDraft) =>
      runtime.send<CollectibleSendDraft, { txId: string }>({ type: "sendCollectible", payload: variables }),
    onSuccess: (_result, variables) => {
      queryClient.setQueryData<Collectible[]>(walletQueryKeys.collectibles(address), (current) =>
        current?.filter((collectible) => collectible.id !== variables.collectible.id),
      );
      void queryClient.invalidateQueries({ queryKey: walletQueryKeys.collectibles(address) });
      void queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances(address) });
      void queryClient.invalidateQueries({ queryKey: walletQueryKeys.activity(address) });
    },
  });
}
