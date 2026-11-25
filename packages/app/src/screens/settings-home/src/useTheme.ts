import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuntimePort, ThemePreference, ThemeSettings } from "@gleam/core";
import { applyDocumentTheme, loadStoredTheme, useSharedTheme } from "../../../theme";

const THEME_QUERY_KEY = ["themePreference"] as const;

/** The stored theme, changed at once on screen and put back if saving fails. */
export function useTheme(runtime: RuntimePort) {
  const shared = useSharedTheme();
  const queryClient = useQueryClient();
  // A shared theme already holds the stored value; this copy serves a host without one.
  const local = useQuery({
    queryKey: THEME_QUERY_KEY,
    queryFn: () => loadStoredTheme(runtime),
    enabled: !shared,
    staleTime: Infinity,
  });
  const theme = shared?.theme ?? local.data ?? "light";

  const show = (next: ThemePreference) => {
    if (shared) shared.setTheme(next);
    else queryClient.setQueryData(THEME_QUERY_KEY, next);
    applyDocumentTheme(next);
  };

  const save = useMutation({
    mutationFn: (next: ThemePreference) =>
      runtime.send<ThemeSettings, void>({ type: "setThemePreference", payload: { theme: next } }),
  });

  return {
    theme,
    saving: save.isPending,
    select: async (next: ThemePreference) => {
      if (next === theme) return;
      const previous = theme;
      show(next);
      try {
        await save.mutateAsync(next);
      } catch {
        show(previous);
      }
    },
  };
}
