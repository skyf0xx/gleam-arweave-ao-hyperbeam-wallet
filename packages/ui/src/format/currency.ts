import { isFiatCurrency, type DisplayCurrency } from "@gleam/core";

/** A formatted value with its token ticker kept apart, so a large figure can set the ticker smaller. */
export interface CurrencyValueParts {
  amount: string;
  /** The AR/AO ticker, or the ISO code of a fiat currency with no symbol; a real symbol stays inside `amount`. */
  unit?: string;
}

// Letters only, like `CHF`, `Fr.` or `AED`: an abbreviation rather than a symbol.
const LATIN_ABBREVIATION = /^[A-Za-z.]+$/;

/**
 * Formats a value already converted into `currency`. Fiat uses the
 * narrow symbol (`$` for both USD and AUD, never `A$` or `AUD`), and the
 * browser locale decides where it sits and how the number is grouped:
 * `$7,830.70` in English, `7.830,70 €` in German, the symbol after the
 * number in Arabic. A currency with no symbol of its own (CHF, AED, KES
 * in English) is shown like a token instead: the amount, then its ISO
 * code as the unit. AR and AO get more decimals below 1, where two would
 * round most balances to zero.
 */
export function formatCurrencyParts(value: number, currency: DisplayCurrency): CurrencyValueParts {
  if (isFiatCurrency(currency)) {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(value);
    const symbol = parts.find((part) => part.type === "currency")?.value ?? "";
    if (!LATIN_ABBREVIATION.test(symbol)) return { amount: parts.map((part) => part.value).join("") };
    // Drops the code with the space that separated it, so `-AED 1,200.00` becomes `-1,200.00`.
    const amount = parts
      .filter((part, index) => {
        if (part.type === "currency") return false;
        const besideCurrency = parts[index - 1]?.type === "currency" || parts[index + 1]?.type === "currency";
        return !(part.type === "literal" && besideCurrency && part.value.trim() === "");
      })
      .map((part) => part.value)
      .join("");
    return { amount, unit: currency };
  }
  const maximumFractionDigits = Math.abs(value) >= 1 || value === 0 ? 2 : 6;
  return { amount: new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value), unit: currency };
}

export function formatCurrencyValue(value: number, currency: DisplayCurrency): string {
  const { amount, unit } = formatCurrencyParts(value, currency);
  return unit ? `${amount} ${unit}` : amount;
}

/** Stands in for any amount while balances are hidden. */
export const HIDDEN_AMOUNT = "••••••";
