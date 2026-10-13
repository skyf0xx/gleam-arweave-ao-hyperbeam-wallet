import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { browser } from "wxt/browser";
import type { ActiveSite, PermissionType, RuntimePort } from "@gleam/core";

export const activeSiteKey = ["activeSite"] as const;

/**
 * The background keeps each tab's other-wallet report in session storage
 * under `session:siteWallet:tab:<id>` (`handlers/site-wallet.ts`). In the
 * session area itself the key has no `session:` prefix.
 */
const TAB_REPORT_KEY_PREFIX = "siteWallet:tab:";

/**
 * The site in the active tab. The side panel stays open across tabs, so
 * this reads again whenever the active tab changes or navigates, and when
 * a page reports another wallet, which happens after its URL changed.
 */
export function useActiveSite(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  useEffect(() => {
    // Absent outside a real extension page, such as under tests.
    const api = browser as typeof browser | undefined;
    const tabs = api?.tabs;
    const storageChanges = api?.storage?.onChanged;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: activeSiteKey });
    const onUpdated = (_tabId: number, change: { url?: string }) => {
      if (change.url) refresh();
    };
    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "session" && Object.keys(changes).some((key) => key.startsWith(TAB_REPORT_KEY_PREFIX))) refresh();
    };
    tabs?.onActivated?.addListener(refresh);
    tabs?.onUpdated?.addListener(onUpdated);
    storageChanges?.addListener(onStorageChanged);
    return () => {
      tabs?.onActivated?.removeListener(refresh);
      tabs?.onUpdated?.removeListener(onUpdated);
      storageChanges?.removeListener(onStorageChanged);
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
