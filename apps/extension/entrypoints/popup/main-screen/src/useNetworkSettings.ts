import { useQuery } from "@tanstack/react-query";
import type { NetworkSettings, RuntimePort } from "@gleam/core";

/**
 * Backs the main screen's gateway status dot with the real configured
 * gateway (`NetworkPeersView` writes it via `setNetworkSettings`) instead
 * of a hard-coded "arweave.net" label. Not address-scoped, matching
 * `useTokenPrices`.
 */
export function useNetworkSettings(runtime: RuntimePort) {
  return useQuery({
    queryKey: ["networkSettings"] as const,
    queryFn: () => runtime.send<void, NetworkSettings>({ type: "getNetworkSettings", payload: undefined }),
  });
}
