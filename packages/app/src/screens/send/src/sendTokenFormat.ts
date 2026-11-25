import type { TokenBalance, TokenPrice } from "@gleam/core";
import { displayTicker, formatAtomicAsDisplay, formatWinstonAsAr } from "../../main-screen/src/formatWinston";

/** `token.ticker` for an AO token, `"AR"` for the native token (`token === null`). */
export function tickerFor(token: TokenBalance | null): string {
  return token === null ? "AR" : displayTicker(token.ticker);
}

export function formatAmount(atomic: string, token: TokenBalance | null): string {
  return token === null ? formatWinstonAsAr(atomic, 12) : formatAtomicAsDisplay(atomic, token.denomination, token.denomination);
}

/** `TokenPrice.price` is `null` for a token that couldn't be priced; that reads as no price here. */
export function priceFor(prices: TokenPrice[] | undefined, token: TokenBalance | null): number | undefined {
  const price = prices?.find((entry) => entry.processId === (token === null ? null : token.processId))?.price;
  return typeof price === "number" ? price : undefined;
}
