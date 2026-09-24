import { useQuery } from "@tanstack/react-query";
import type { ActivityPage, RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

/**
 * Shared, cached source of truth for the merged activity feed, so
 * `SendView`'s `RecentRecipientsStep` and `MainScreenView` share one
 * fetch instead of each running its own. Wraps the existing
 * `runtime.send({ type: "getActivity" })` call as a queryFn.
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
