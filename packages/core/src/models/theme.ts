/**
 * The user-controlled theme preference. No "system/auto" option; light is
 * the default for a wallet with no stored preference yet.
 */
export const THEME_PREFERENCES = ["light", "dark", "silica"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Mirrors `LockSettings`/`NetworkSettings`'s single-field settings-object
 * shape rather than a bare `ThemePreference` return, so
 * `getThemePreference`/`setThemePreference` follow the same
 * request/response convention as the other settings pairs.
 *
 * The "no stored preference yet defaults to light" rule is a
 * storage-layer concern (`apps/extension/src/adapters/storage.ts`), out
 * of this model's scope.
 */
export interface ThemeSettings {
  theme: ThemePreference;
  /** Silica's sky follows the portfolio. Absent is off; kept while another theme is on. */
  weather?: boolean;
}

export function isThemeSettings(value: unknown): value is ThemeSettings {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    THEME_PREFERENCES.includes(record.theme as ThemePreference) &&
    (record.weather === undefined || typeof record.weather === "boolean")
  );
}

/** A stored record, or `null` when it is malformed. Silica used to be stored as `paper`. */
export function readThemeSettings(value: unknown): ThemeSettings | null {
  const record = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const upgraded = record?.theme === "paper" ? { ...record, theme: "silica" } : value;
  if (!isThemeSettings(upgraded)) return null;
  return { theme: upgraded.theme, ...(upgraded.weather ? { weather: true } : {}) };
}
