import { useEffect, useState } from "react";
import type { RuntimePort, ThemePreference, ThemeSettings } from "@gleam/core";
import { applyDocumentTheme, loadStoredTheme, useSharedTheme } from "../../../theme";

/** The stored theme, changed at once on screen and put back if saving fails. */
export function useTheme(runtime: RuntimePort) {
  const shared = useSharedTheme();
  const [local, setLocal] = useState<ThemePreference>("light");
  const [saving, setSaving] = useState(false);
  const theme = shared?.theme ?? local;

  useEffect(() => {
    if (shared) return;
    let cancelled = false;
    void loadStoredTheme(runtime).then((stored) => {
      if (!cancelled) setLocal(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, shared]);

  const show = (next: ThemePreference) => {
    if (shared) shared.setTheme(next);
    else setLocal(next);
    applyDocumentTheme(next);
  };

  return {
    theme,
    saving,
    select: async (next: ThemePreference) => {
      if (next === theme) return;
      const previous = theme;
      show(next);
      setSaving(true);
      try {
        await runtime.send<ThemeSettings, void>({ type: "setThemePreference", payload: { theme: next } });
      } catch {
        show(previous);
      } finally {
        setSaving(false);
      }
    },
  };
}
