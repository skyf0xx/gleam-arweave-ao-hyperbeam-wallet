import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ActivityPage, Collectible } from "@gleam/core";
import { walletQueryKeys } from "../../activity";

/**
 * Refetches the collectibles list when activity shows one received since
 * the list was fetched, at most once per activity read.
 */
export function useCollectiblesCatchUp(
  address: string,
  collectibles: readonly Collectible[] | undefined,
  activity: ActivityPage | undefined,
  activityUpdatedAt: number,
): void {
  const queryClient = useQueryClient();
  const refetchedFor = useRef(0);
  useEffect(() => {
    if (!collectibles || refetchedFor.current === activityUpdatedAt) return;
    const ids = new Set(collectibles.map((collectible) => collectible.id));
    const missing = activity?.entries.some(
      (entry) => entry.type === "receive" && entry.collectible && !ids.has(entry.collectible.id),
    );
    if (!missing) return;
    refetchedFor.current = activityUpdatedAt;
    void queryClient.invalidateQueries({ queryKey: walletQueryKeys.collectibles(address) });
  }, [activity, activityUpdatedAt, collectibles, queryClient, address]);
}
