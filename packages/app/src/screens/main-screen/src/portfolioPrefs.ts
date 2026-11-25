import type { PortfolioHistoryRange, PortfolioScope } from "@gleam/core";

// A per-device view preference, so plain localStorage; it can throw or be empty in some contexts.
const PORTFOLIO_SCOPE_STORAGE_KEY = "gleam:portfolioScope";

export function readPortfolioScope(): PortfolioScope {
  try {
    return window.localStorage.getItem(PORTFOLIO_SCOPE_STORAGE_KEY) === "all" ? "all" : "wallet";
  } catch {
    return "wallet";
  }
}

export function writePortfolioScope(scope: PortfolioScope): void {
  try {
    window.localStorage.setItem(PORTFOLIO_SCOPE_STORAGE_KEY, scope);
  } catch {
    // Not persisting only means the next open starts on this wallet.
  }
}

const PORTFOLIO_RANGE_STORAGE_KEY = "gleam:portfolioRange";
const PORTFOLIO_RANGES: readonly PortfolioHistoryRange[] = ["24H", "7D", "1M", "1Y", "ALL"];

export function readPortfolioRange(): PortfolioHistoryRange {
  try {
    const stored = window.localStorage.getItem(PORTFOLIO_RANGE_STORAGE_KEY);
    return PORTFOLIO_RANGES.find((range) => range === stored) ?? "7D";
  } catch {
    return "7D";
  }
}

export function writePortfolioRange(range: PortfolioHistoryRange): void {
  try {
    window.localStorage.setItem(PORTFOLIO_RANGE_STORAGE_KEY, range);
  } catch {
    // Not persisting only means the next open starts on 7D.
  }
}
