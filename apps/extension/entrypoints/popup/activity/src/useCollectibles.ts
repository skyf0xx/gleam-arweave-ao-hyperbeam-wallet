import { useQuery } from "@tanstack/react-query";
import type { Collectible, RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

/**
 * The wallet's AO NFTs. Its own query, apart from `useBalances`, so a slow
 * discovery never holds up the token list. The background caches per
 * wallet, so this only goes stale in the popup after a few minutes.
 */
export function useCollectibles(runtime: RuntimePort, address: string) {
  return useQuery({
    queryKey: walletQueryKeys.collectibles(address),
    queryFn: () =>
      runtime.send<{ address: string }, Collectible[]>({
        type: "getCollectibles",
        payload: { address },
      }),
    staleTime: 5 * 60_000,
  });
}
