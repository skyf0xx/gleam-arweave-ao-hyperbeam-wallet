/**
 * Pure reducer: no fetching inside it. `priceAt` is the caller's
 * responsibility to construct (e.g. via `buildPriceAtFromSeries`) and
 * must itself return `0` for any timestamp it can't price — never throw,
 * never skip the token. `balance` is a given, current/latest-known
 * number; reconstructing true historical balances from on-chain activity
 * is out of scope for this estimate.
 */
export interface PricedHistoricalToken {
  balance: number;
  priceAt: (timestamp: number) => number;
}

export function estimateHistoricalPortfolioValue(
  tokens: PricedHistoricalToken[],
  timestamp: number,
): number {
  return tokens.reduce(
    (total, token) => total + token.balance * token.priceAt(timestamp),
    0,
  );
}
