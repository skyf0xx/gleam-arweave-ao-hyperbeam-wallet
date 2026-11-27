import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, Winston } from "@gleam/core";

/** The supply moves by block rewards only, so one read a session is enough. */
export function useArTotalSupply(runtime: RuntimePort, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ["arTotalSupply"] as const,
    queryFn: () => runtime.send<void, Winston>({ type: "getArTotalSupply", payload: undefined }),
    staleTime: Infinity,
    retry: 1,
  });
}
