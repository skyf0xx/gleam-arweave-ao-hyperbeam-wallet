import { useQuery, useQueryClient } from "@tanstack/react-query";
import { defaultDisplaySettings, type DisplaySettings, type RuntimePort } from "@gleam/core";

const DISPLAY_SETTINGS_QUERY_KEY = ["displaySettings"] as const;

/**
 * The display currency, headline, chart and hidden-balances choices, shared
 * by the main screen and Settings through one query so a change in one shows
 * in the other at once. `settings` is `undefined` only while the first read
 * is in flight; a failed read falls back to the locale defaults rather than
 * leaving every balance unpriced.
 */
export function useDisplaySettings(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: DISPLAY_SETTINGS_QUERY_KEY,
    queryFn: () => runtime.send<void, DisplaySettings>({ type: "getDisplaySettings", payload: undefined }),
    staleTime: Infinity,
  });
  const settings = query.data ?? (query.isError ? defaultDisplaySettings(navigator.language) : undefined);

  /** Applies at once and rolls back if the background refuses the write. */
  const update = async (change: Partial<DisplaySettings>) => {
    if (!settings) return;
    const next = { ...settings, ...change };
    queryClient.setQueryData(DISPLAY_SETTINGS_QUERY_KEY, next);
    try {
      await runtime.send<DisplaySettings, void>({ type: "setDisplaySettings", payload: next });
    } catch {
      queryClient.setQueryData(DISPLAY_SETTINGS_QUERY_KEY, settings);
    }
  };

  return { settings, update };
}
