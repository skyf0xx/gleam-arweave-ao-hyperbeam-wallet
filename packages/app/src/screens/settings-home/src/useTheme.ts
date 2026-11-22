import { useEffect, useState } from "react";
import type { RuntimePort, ThemePreference, ThemeSettings } from "@gleam/core";
import { applyDocumentTheme, useSharedTheme } from "../../../theme";

/** The stored theme and its weather switch, changed at once on screen and put back if saving fails. */
export function useTheme(runtime: RuntimePort) {
  const shared = useSharedTheme();
  const [local, setLocal] = useState<{ theme: ThemePreference; weather: boolean }>({ theme: "light", weather: false });
  const [saving, setSaving] = useState(false);
  const { theme, weather } = shared ?? local;

  useEffect(() => {
    if (shared) return;
    let cancelled = false;
    runtime
      .send<void, ThemeSettings>({ type: "getThemePreference", payload: undefined })
      .then((settings) => {
        if (!cancelled) setLocal({ theme: settings.theme, weather: settings.weather === true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runtime, shared]);

  const show = (next: { theme: ThemePreference; weather: boolean }) => {
    if (shared) {
      shared.setTheme(next.theme);
      shared.setWeather(next.weather);
    } else setLocal(next);
    applyDocumentTheme(next.theme);
  };

  const save = async (next: { theme: ThemePreference; weather: boolean }) => {
    const previous = { theme, weather };
    show(next);
    setSaving(true);
    try {
      await runtime.send<ThemeSettings, void>({
        type: "setThemePreference",
        payload: { theme: next.theme, ...(next.weather ? { weather: true } : {}) },
      });
    } catch {
      show(previous);
    } finally {
      setSaving(false);
    }
  };

  return {
    theme,
    weather,
    saving,
    select: async (next: ThemePreference) => {
      if (next !== theme) await save({ theme: next, weather });
    },
    toggleWeather: () => save({ theme, weather: !weather }),
  };
}
