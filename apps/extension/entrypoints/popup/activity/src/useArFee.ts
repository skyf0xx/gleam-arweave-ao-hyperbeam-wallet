import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, Winston } from "@gleam/core";

/**
 * Rough, recipient-less AR fee estimate for the compose step's "Max"
 * pill. Not wallet-address-keyed — see `getArFee`'s own doc comment.
 */
export function useArFee(runtime: RuntimePort) {
  return useQuery({
    queryKey: ["arFee"] as const,
    queryFn: () => runtime.send<void, Winston>({ type: "getArFee", payload: undefined }),
  });
}
