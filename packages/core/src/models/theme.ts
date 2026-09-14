/**
 * The user-controlled light/dark theme preference (theme-preference intent).
 * Exactly two states — no "system/auto" option — light is the default for a
 * wallet with no stored preference yet (`ThemeSettings`'s doc comment below
 * names where that default is applied).
 */
export type ThemePreference = "light" | "dark";

/**
 * Mirrors `LockSettings`/`NetworkSettings`'s single-field settings-object
 * shape (`session.ts`/`network.ts`) rather than a bare `ThemePreference`
 * return, so `getThemePreference`/`setThemePreference` follow the same
 * request/response convention as `getLockSettings`/`setLockSettings` and
 * `getNetworkSettings`/`setNetworkSettings`.
 *
 * The "no stored preference yet defaults to light" rule is a storage-layer
 * concern (`apps/extension/src/adapters/storage.ts`, out of this layer's
 * scope) — this model only pins the shape, not the default-supplying logic.
 */
export interface ThemeSettings {
  theme: ThemePreference;
}
