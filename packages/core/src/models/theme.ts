/**
 * The user-controlled light/dark theme preference. Exactly two states —
 * no "system/auto" option — light is the default for a wallet with no
 * stored preference yet.
 */
export const THEME_PREFERENCES = ["light", "dark"] as const;

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
}

export function isThemeSettings(value: unknown): value is ThemeSettings {
  return (
    value !== null &&
    typeof value === "object" &&
    THEME_PREFERENCES.includes((value as Record<string, unknown>).theme as ThemePreference)
  );
}
