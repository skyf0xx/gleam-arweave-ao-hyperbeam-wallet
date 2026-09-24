/**
 * The user-controlled light/dark theme preference. Exactly two states —
 * no "system/auto" option — light is the default for a wallet with no
 * stored preference yet.
 */
export type ThemePreference = "light" | "dark";

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
