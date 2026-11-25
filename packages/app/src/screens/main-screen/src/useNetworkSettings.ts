import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NetworkSettings, RuntimePort } from "@gleam/core";

/**
 * Backs the main screen's gateway status dot with the real configured
 * gateway (`NetworkPeersView` writes it via `setNetworkSettings`) instead
 * of a hard-coded "arweave.net" label. Not address-scoped, matching
 * `useTokenPrices`.
 */
const NETWORK_SETTINGS_QUERY_KEY = ["networkSettings"] as const;

export function useNetworkSettings(runtime: RuntimePort, enabled = true) {
  return useQuery({
    queryKey: NETWORK_SETTINGS_QUERY_KEY,
    queryFn: () => runtime.send<void, NetworkSettings>({ type: "getNetworkSettings", payload: undefined }),
    enabled,
  });
}

export function useSaveNetworkSettings(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (next: NetworkSettings) => runtime.send<NetworkSettings, void>({ type: "setNetworkSettings", payload: next }),
    onSuccess: (_result, next) => {
      queryClient.setQueryData(NETWORK_SETTINGS_QUERY_KEY, next);
    },
  });
}
