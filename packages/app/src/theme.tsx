import { createContext, useContext } from "react";
import type { ThemePreference } from "@gleam/core";

export interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

/**
 * `App` drives its root `data-theme` from its own state, so a toggle has to
 * change that state too: writing only `documentElement` leaves the root on
 * the theme it had at init. Null outside `App` (screen tests).
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useSharedTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

/** Light is the unmarked default; every other theme names itself in `data-theme`. */
export function themeAttribute(theme: ThemePreference): string | undefined {
  return theme === "light" ? undefined : theme;
}

export function applyDocumentTheme(theme: ThemePreference) {
  const value = themeAttribute(theme);
  if (value) document.documentElement.setAttribute("data-theme", value);
  else document.documentElement.removeAttribute("data-theme");
}

/** Silica's sky, behind every screen (theme.css). */
export function Sky() {
  return <div aria-hidden="true" data-testid="sky" className="gleam-sky" />;
}
