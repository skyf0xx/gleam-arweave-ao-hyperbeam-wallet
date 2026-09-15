import { useQuery } from "@tanstack/react-query";
import type { ActivityPage, RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

/**
 * Shared, cached source of truth for the merged activity feed — replaces
 * the duplicated `getActivity` `useState`/`useEffect` blocks previously
 * local to `SendView`'s `RecentRecipientsStep` and `MainScreenView`.
 * Wraps the same existing `runtime.send({ type: "getActivity" })` call as
 * a queryFn (RELEVANT RULES: "The activity feed … is fetched via
 * useQuery"), no change to the transport layer.
 *
 * Keyed by `[address, 'activity']` (`walletQueryKeys.activity`).
 */
export function useActivity(runtime: RuntimePort, address: string) {
  return useQuery({
    queryKey: walletQueryKeys.activity(address),
    queryFn: () =>
      runtime.send<{ address: string }, ActivityPage>({
        type: "getActivity",
        payload: { address },
      }),
  });
}
