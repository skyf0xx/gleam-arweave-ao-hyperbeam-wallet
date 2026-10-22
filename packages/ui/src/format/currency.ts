import { isFiatCurrency, type DisplayCurrency } from "@gleam/core";

/**
 * Formats a value already converted into `currency`. Fiat uses the
 * browser locale's own symbol, separators and decimals (no decimals for
 * JPY, `1.234,56 €` in Germany); AR and AO get a ticker suffix and more
 * decimals below 1, where two would round most balances to zero.
 */
export function formatCurrencyValue(value: number, currency: DisplayCurrency): string {
  if (isFiatCurrency(currency)) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  }
  const maximumFractionDigits = Math.abs(value) >= 1 || value === 0 ? 2 : 6;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)} ${currency}`;
}

/** Stands in for any amount while balances are hidden. */
export const HIDDEN_AMOUNT = "••••••";
