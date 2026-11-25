import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Grant, RuntimePort } from "@gleam/core";

export const CONNECTED_APPS_QUERY_KEY = ["connectedApps"] as const;

export function useConnectedApps(runtime: RuntimePort) {
  return useQuery({
    queryKey: CONNECTED_APPS_QUERY_KEY,
    queryFn: () => runtime.send<void, Grant[]>({ type: "getConnectedApps", payload: undefined }),
  });
}

export function useRevokeGrant(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (origin: string) => runtime.send<{ origin: string }, void>({ type: "revokeGrant", payload: { origin } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTED_APPS_QUERY_KEY }),
  });
}
