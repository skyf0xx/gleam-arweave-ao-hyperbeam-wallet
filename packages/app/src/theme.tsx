import { createContext, useContext } from "react";
import type { ThemePreference } from "@gleam/core";

/** Which way the portfolio went over the chart period on screen; `flat` covers none, unknown and too small to show. */
export type Market = "up" | "down" | "flat";

/** Under 0.05% the figure reads 0.0%, and the sky shouldn't flip on less than the figure shows. */
const FLAT_CHANGE = 0.0005;

export function marketOf(change: number): Market {
  if (!(Math.abs(change) >= FLAT_CHANGE)) return "flat";
  return change > 0 ? "up" : "down";
}

export interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  weather: boolean;
  setWeather: (weather: boolean) => void;
  /** The main screen says which way the portfolio went; `App` draws the sky, which outlives that screen. */
  reportMarket: (market: Market) => void;
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

/** Silica's sky, behind every screen. The three skies are stacked so a change is an opacity cross-fade (theme.css). */
export function Sky({ market }: { market: Market }) {
  return (
    <div aria-hidden="true" data-testid="sky" data-market={market} className="gleam-sky">
      <div className="gleam-sky-flat" />
      <div className="gleam-sky-up" />
      <div className="gleam-sky-down" />
    </div>
  );
}
