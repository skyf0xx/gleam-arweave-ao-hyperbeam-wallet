import type { TFunction } from "./i18n";

/** How long ago something happened, as the activity feed words it ("just now", "5m ago"). */
export function relativeTime(t: TFunction, timestampMs: number): string {
  if (timestampMs <= 0) return t("mainScreen.timePending");
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t("mainScreen.justNow");
  if (minutes < 60) return t("mainScreen.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("mainScreen.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("mainScreen.daysAgo", { count: days });
}
