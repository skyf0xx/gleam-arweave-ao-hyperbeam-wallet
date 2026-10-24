import { useQuery } from "@tanstack/react-query";
import type { ActivityPage, RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

const PENDING_REFETCH_MS = 15_000;

/**
 * Shared, cached source of truth for the merged activity feed, so
 * `SendView`'s `RecentRecipientsStep` and `MainScreenView` share one
 * fetch instead of each running its own. Wraps the existing
 * `runtime.send({ type: "getActivity" })` call as a queryFn.
 *
 * Keyed by `[address, 'activity']` (`walletQueryKeys.activity`).
 *
 * Polls while an entry is pending: the background alarm settles it in
 * storage, and an open popup otherwise wouldn't read it again.
 */
export function useActivity(runtime: RuntimePort, address: string) {
  return useQuery({
    queryKey: walletQueryKeys.activity(address),
    queryFn: () =>
      runtime.send<{ address: string }, ActivityPage>({
        type: "getActivity",
        payload: { address },
      }),
    refetchInterval: (query) =>
      query.state.data?.entries.some((entry) => entry.status === "pending") ? PENDING_REFETCH_MS : false,
  });
}
