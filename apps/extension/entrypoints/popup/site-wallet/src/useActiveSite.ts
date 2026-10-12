import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { browser } from "wxt/browser";
import type { ActiveSite, PermissionType, RuntimePort } from "@gleam/core";

export const activeSiteKey = ["activeSite"] as const;

/**
 * The site in the active tab. The side panel stays open across tabs, so
 * this reads again whenever the active tab changes or navigates.
 */
export function useActiveSite(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  useEffect(() => {
    // Absent outside a real extension page, such as under tests.
    const tabs = (browser as typeof browser | undefined)?.tabs;
    if (!tabs?.onActivated || !tabs.onUpdated) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: activeSiteKey });
    const onUpdated = (_tabId: number, change: { url?: string }) => {
      if (change.url) refresh();
    };
    tabs.onActivated.addListener(refresh);
    tabs.onUpdated.addListener(onUpdated);
    return () => {
      tabs.onActivated.removeListener(refresh);
      tabs.onUpdated.removeListener(onUpdated);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: activeSiteKey,
    queryFn: () => runtime.send<undefined, ActiveSite | null>({ type: "getActiveSite", payload: undefined }),
    retry: false,
  });
}

export function useUseGleamOnSite(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: { origin: string; permissions: PermissionType[] }) =>
      runtime.send<typeof req, void>({ type: "useGleamOnSite", payload: req }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activeSiteKey }),
  });
}

export function useStopGleamOnSite(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (origin: string) => runtime.send<{ origin: string }, void>({ type: "stopGleamOnSite", payload: { origin } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activeSiteKey }),
  });
}

export function useDismissSiteSuggestion(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (origin: string) =>
      runtime.send<{ origin: string }, void>({ type: "dismissSiteSuggestion", payload: { origin } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: activeSiteKey }),
  });
}
