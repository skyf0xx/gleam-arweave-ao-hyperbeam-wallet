import {
  defaultDisplaySettings,
  isDisplaySettings,
  isLockSettings,
  isThemeSettings,
  type DisplaySettings,
  type LockSettings,
  type StoragePort,
  type ThemeSettings,
} from "@gleam/core";
import { dappError } from "../dapp-error";

export const LOCK_SETTINGS_KEY = "local:lockSettings";
const THEME_SETTINGS_KEY = "local:themeSettings";
const DISPLAY_SETTINGS_KEY = "local:displaySettings";

const DEFAULT_LOCK_SETTINGS: LockSettings = { autoLockTimeout: "1hr" };
const DEFAULT_THEME_SETTINGS: ThemeSettings = { theme: "light" };

export async function loadLockSettings(storage: StoragePort): Promise<LockSettings> {
  const raw = await storage.get<unknown>(LOCK_SETTINGS_KEY);
  if (isLockSettings(raw)) return { autoLockTimeout: raw.autoLockTimeout };
  return DEFAULT_LOCK_SETTINGS;
}

export async function loadThemeSettings(storage: StoragePort): Promise<ThemeSettings> {
  const raw = await storage.get<unknown>(THEME_SETTINGS_KEY);
  if (isThemeSettings(raw)) return { theme: raw.theme };
  return DEFAULT_THEME_SETTINGS;
}

export async function loadDisplaySettings(storage: StoragePort): Promise<DisplaySettings> {
  const raw = await storage.get<unknown>(DISPLAY_SETTINGS_KEY);
  // Older records lack `tokenLogos` and `tokenRows`, and carry `compactHeader` (or before it `showChart`) in place
  // of `header`. Someone who had turned the chart off gets the compact header, the closest thing to it.
  // `tokenLogos` replaced `showTokenLogos`, which defaulted off and so was stored as false for
  // nearly everyone; it is ignored so they get logos, the new default.
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const upgraded = record
    ? { tokenLogos: true, tokenRows: "detailed", header: record.compactHeader === true || record.showChart === false ? "compact" : "full", ...record }
    : raw;
  if (isDisplaySettings(upgraded)) {
    return {
      currency: upgraded.currency,
      header: upgraded.header,
      tokenLogos: upgraded.tokenLogos,
      tokenRows: upgraded.tokenRows,
      headline: upgraded.headline,
      balancesHidden: upgraded.balancesHidden,
    };
  }
  return defaultDisplaySettings(globalThis.navigator?.language);
}

export async function saveThemeSettings(storage: StoragePort, req: ThemeSettings): Promise<void> {
  if (!isThemeSettings(req)) {
    throw new Error(dappError(`Invalid theme preference "${String((req as Partial<ThemeSettings>).theme)}".`));
  }
  // eslint-disable-next-line gleam/no-storage-read-modify-write -- overwrites the whole value with the validated request, not one computed from the stored one
  await storage.set(THEME_SETTINGS_KEY, { theme: req.theme });
}

export async function saveDisplaySettings(storage: StoragePort, req: DisplaySettings): Promise<void> {
  if (!isDisplaySettings(req)) throw new Error(dappError("Invalid display settings."));
  // eslint-disable-next-line gleam/no-storage-read-modify-write -- overwrites the whole value with the validated request, not one computed from the stored one
  await storage.set(DISPLAY_SETTINGS_KEY, {
    currency: req.currency,
    header: req.header,
    tokenLogos: req.tokenLogos,
    tokenRows: req.tokenRows,
    headline: req.headline,
    balancesHidden: req.balancesHidden,
  });
}
