import { useQuery } from "@tanstack/react-query";
import type { Collectible, RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";
import { retryWhileFailed } from "../../../query-cache/retry";

/**
 * The wallet's AO NFTs. Its own query, apart from `useBalances`, so a slow
 * discovery never holds up the token list. The background caches per
 * wallet for 90 seconds. Past a minute the popup shows the list it has
 * while it asks again.
 */
export function useCollectibles(runtime: RuntimePort, address: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: walletQueryKeys.collectibles(address),
    queryFn: () =>
      runtime.send<{ address: string }, Collectible[]>({
        type: "getCollectibles",
        payload: { address },
      }),
    staleTime: 60_000,
    refetchInterval: retryWhileFailed,
    enabled: options.enabled ?? true,
  });
}
