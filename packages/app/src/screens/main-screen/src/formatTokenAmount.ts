import { formatAtomicCompact } from "./formatWinston";

const FORMATS = new Map<string, { whole: Intl.NumberFormat; decimal: string }>();

function localeFormat(locale: string): { whole: Intl.NumberFormat; decimal: string } {
  let format = FORMATS.get(locale);
  if (!format) {
    const whole = new Intl.NumberFormat(locale);
    const decimal = whole.formatToParts(1.5).find((part) => part.type === "decimal")?.value ?? ".";
    format = { whole, decimal };
    FORMATS.set(locale, format);
  }
  return format;
}

/**
 * Regroups an amount from the `formatWinston` helpers (`1234.5678`,
 * `0.0₄1`) for the reader's locale: `1,234.5678` in English, `1.234,5678`
 * in Spanish. The whole part is grouped as a `BigInt`, so no digit passes
 * through a float. For showing only; anything else comes back unchanged.
 */
export function localizeAmount(shown: string, locale: string): string {
  const dot = shown.indexOf(".");
  const whole = dot === -1 ? shown : shown.slice(0, dot);
  if (!/^\d+$/.test(whole)) return shown;
  const format = localeFormat(locale);
  const grouped = format.whole.format(BigInt(whole));
  return dot === -1 ? grouped : `${grouped}${format.decimal}${shown.slice(dot + 1)}`;
}

/** `formatAtomicCompact` in the reader's locale. */
export function formatTokenAmount(atomic: string, denomination: number, locale: string): string {
  return localizeAmount(formatAtomicCompact(atomic, denomination), locale);
}
