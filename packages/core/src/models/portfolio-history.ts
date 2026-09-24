/**
 * The main-screen total-portfolio-value chart's wire shape. Deliberately
 * its own model rather than a re-export of `core/pricing`'s
 * `HistoricalRange`/`HistoricalPricePoint` — `pricing` is a background-side
 * implementation detail; the messaging contract only pins what the popup
 * is allowed to ask for and what shape it gets back.
 */
export type PortfolioHistoryRange = "24H" | "7D" | "1M" | "1Y" | "ALL";

/** One point on the portfolio-value-over-time chart. */
export interface PortfolioHistoryPoint {
  timestamp: number;
  usdValue: number;
}

/**
 * The full response for a requested range: the series to plot plus the
 * summary figures the main screen shows alongside it — computed once in
 * the background so the popup never re-derives them from the raw series
 * on every render. `usdChange` is a fraction (e.g. `0.0421` for +4.21%),
 * not a pre-formatted string. An empty `series` (both price sources
 * unavailable) means "couldn't compute" — the popup shows
 * `NetworkErrorBanner` for that case rather than a fabricated flat line.
 */
export interface PortfolioHistory {
  range: PortfolioHistoryRange;
  series: PortfolioHistoryPoint[];
  currentUsdValue: number;
  usdChange: number;
  periodLabel: string;
}
