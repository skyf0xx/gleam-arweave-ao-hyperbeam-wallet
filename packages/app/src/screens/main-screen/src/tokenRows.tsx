import type { ReactNode } from "react";
import type { DisplayCurrency, PendingAmounts, TokenBalance, TokenPrice } from "@gleam/core";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
import { formatCurrencyValue } from "@gleam/ui/src/format/currency.ts";
import { formatAtomicAsDisplay, formatAtomicCompact, formatWinstonAsAr } from "./formatWinston";
import type { TFunction } from "../../../i18n";
import type { WalletBalances } from "../../activity/src/useBalances";

/**
 * A default (AR/AO) row carries enough to render a `TokenRow` and to be
 * clicked into the send flow: `"ar"` opens it for AR, a `TokenBalance`
 * for that AO token, and `null` leaves the row unclickable (an AO balance
 * that isn't loaded or couldn't be read).
 */
export interface DefaultTokenRow {
  key: string;
  ticker: string;
  name: string;
  logoUrl: string;
  amount: string;
  pending?: PendingAmounts;
  /** `amount` in display units, only for drawing a tick between two figures; `undefined` when there's no figure. */
  amountNumber: number | undefined;
  value: { text: string; number: number } | undefined;
  /** The price of one token, unless the display currency is that token or there's no holding to multiply. */
  unitPrice: string | undefined;
  change: number | undefined;
  send: "ar" | TokenBalance | null;
}

/**
 * Shown in place of a formatted amount for a `TokenBalance` whose
 * `available` is `false` (`handlers/reads.ts`: a failed HyperBEAM read, or
 * a non-AO token whose denomination couldn't be confirmed) — never a
 * guessed quantity, which for a wrong denomination could be off by orders
 * of magnitude.
 */
// Compared by value below, so it is resolved at render time in the language in use.
export const unavailableBalanceLabel = (t: TFunction): string => t("mainScreen.unavailable");

/** `0.2 sending`, `+0.5 arriving`, or both. With balances hidden the amounts go, and the words stay. */
export function pendingNote(t: TFunction, pending: PendingAmounts | undefined, denomination: number, masked: boolean): string | null {
  if (!pending) return null;
  const notes: string[] = [];
  if (pending.outgoing !== "0") notes.push(masked ? t("mainScreen.sending") : t("mainScreen.sendingAmount", { amount: formatAtomicCompact(pending.outgoing, denomination) }));
  if (pending.incoming !== "0") notes.push(masked ? t("mainScreen.arriving") : t("mainScreen.arrivingAmount", { amount: formatAtomicCompact(pending.incoming, denomination) }));
  return notes.length > 0 ? notes.join(t("mainScreen.noteSeparator")) : null;
}

export function withPendingNote(amount: string, note: string | null): ReactNode {
  if (note === null) return amount;
  return (
    <>
      {amount} · <span className="font-medium text-foreground">{note}</span>
    </>
  );
}

/**
 * Looks up a token's price (by AO `processId`, or `null` for AR) from
 * `useTokenPrices()`'s cache and formats `amount * price` in the display
 * currency — `undefined` when the price isn't loaded yet or couldn't be
 * computed (`TokenPrice.price === null`, per that query's own HONESTY
 * contract), so `TokenRow` renders no value line rather than a fabricated
 * `$0.00`.
 */
export function valueFor(
  prices: TokenPrice[] | undefined,
  currency: DisplayCurrency | undefined,
  processId: string | null,
  amount: number,
): { text: string; number: number } | undefined {
  const price = prices?.find((entry) => entry.processId === processId)?.price;
  if (typeof price !== "number" || !currency) return undefined;
  const number = amount * price;
  return { text: formatCurrencyValue(number, currency), number };
}

export function unitPriceFor(
  prices: TokenPrice[] | undefined,
  currency: DisplayCurrency | undefined,
  processId: string | null,
  ticker: string,
  amount: number,
): string | undefined {
  const price = prices?.find((entry) => entry.processId === processId)?.price;
  if (typeof price !== "number" || !currency || currency === ticker || amount === 0) return undefined;
  return formatCurrencyValue(price, currency);
}

export function changeFor(prices: TokenPrice[] | undefined, processId: string | null): number | undefined {
  return prices?.find((entry) => entry.processId === processId)?.change24h ?? undefined;
}

/** No data yet and either a first read in flight or a failed one waiting on its retry, so nothing is shown as zero. */
export function waiting(query: { isLoading: boolean; isError: boolean; data: unknown }): boolean {
  return query.isLoading || (query.isError && query.data === undefined);
}

/**
 * Whether a query still shows data from before this screen opened.
 * Keyed on the data, not the status: a refetch that fails (status error) keeps the old data, and it stays old.
 */
export function restoredCache(query: { data: unknown; dataUpdatedAt: number }, openedAt: number): boolean {
  return query.data !== undefined && query.dataUpdatedAt < openedAt;
}

/**
 * Builds the AR/AO default rows always shown at the top of the Tokens tab.
 * Reads straight off `useBalances()`'s cache: `undefined`
 * `data` (not yet loaded) or no matching `TokenBalance` entry both fall
 * back to `DEFAULT_TOKENS`' own `"0"` constant, never `null`/`undefined`.
 */
export function buildDefaultTokenRows(
  t: TFunction,
  data: WalletBalances | undefined,
  prices: TokenPrice[] | undefined,
  currency: DisplayCurrency | undefined,
): DefaultTokenRow[] {
  const aoBalance = data?.tokenBalances.find((token) => token.processId === DEFAULT_AO_TOKEN.processId);
  const aoAvailable = aoBalance !== undefined && aoBalance.available !== false;
  const arAmount = data?.arBalance !== undefined ? Number(formatWinstonAsAr(data.arBalance, 12)) : 0;
  const aoAmount = aoAvailable ? Number(formatAtomicAsDisplay(aoBalance.quantity, aoBalance.denomination, aoBalance.denomination)) : 0;

  return [
    {
      key: "default-ar",
      ticker: DEFAULT_AR_TOKEN.ticker,
      name: DEFAULT_AR_TOKEN.name,
      logoUrl: DEFAULT_AR_TOKEN.logoUrl,
      amount: data?.arBalance !== undefined ? formatAtomicCompact(data.arBalance, 12) : DEFAULT_AR_TOKEN.defaultDisplayAmount,
      pending: data?.arPending,
      amountNumber: data?.arBalance !== undefined ? arAmount : undefined,
      value: data?.arBalance !== undefined ? valueFor(prices, currency, null, arAmount) : undefined,
      unitPrice: data?.arBalance !== undefined ? unitPriceFor(prices, currency, null, DEFAULT_AR_TOKEN.ticker, arAmount) : undefined,
      change: data?.arBalance !== undefined ? changeFor(prices, null) : undefined,
      send: "ar",
    },
    {
      key: "default-ao",
      ticker: DEFAULT_AO_TOKEN.ticker,
      name: DEFAULT_AO_TOKEN.name,
      logoUrl: DEFAULT_AO_TOKEN.logoUrl,
      amount: aoAvailable
        ? formatAtomicCompact(aoBalance.quantity, aoBalance.denomination)
        : aoBalance
          ? unavailableBalanceLabel(t)
          : DEFAULT_AO_TOKEN.defaultDisplayAmount,
      pending: aoAvailable ? aoBalance.pending : undefined,
      amountNumber: aoAvailable ? aoAmount : undefined,
      value: aoAvailable ? valueFor(prices, currency, DEFAULT_AO_TOKEN.processId, aoAmount) : undefined,
      unitPrice: aoAvailable ? unitPriceFor(prices, currency, DEFAULT_AO_TOKEN.processId, DEFAULT_AO_TOKEN.ticker, aoAmount) : undefined,
      change: aoAvailable ? changeFor(prices, DEFAULT_AO_TOKEN.processId) : undefined,
      send: aoAvailable ? (aoBalance ?? null) : null,
    },
  ];
}

/**
 * The non-default watched tokens rendered below the AR/AO rows — every
 * `TokenBalance` whose `processId` isn't the AO default. These have no
 * entry in `DEFAULT_TOKEN_REGISTRY`, so they carry a price only when
 * `useOrderbookPrices` found one; otherwise `valueFor` resolves
 * `undefined` and the row shows no value line.
 */
export function nonDefaultTokenBalances(data: WalletBalances | undefined): TokenBalance[] {
  return (data?.tokenBalances ?? []).filter((token) => token.processId !== DEFAULT_AO_TOKEN.processId);
}

/**
 * The tokens worth asking an orderbook about: ones the user added, whose
 * balance resolved. A discovered token's name and logo are the sender's
 * claim, so its price would be too.
 */
export function pricedTokenIds(data: WalletBalances | undefined): string[] {
  return nonDefaultTokenBalances(data)
    .filter((token) => token.source !== "discovered" && token.available !== false)
    .map((token) => token.processId)
    .sort();
}

/**
 * What the priced orderbook tokens are worth now. The chart's history only
 * covers AR and AO, so without this the total reads lower than the rows
 * under it.
 */
export function orderbookHoldingsValue(data: WalletBalances | undefined, prices: TokenPrice[] | undefined, currency: DisplayCurrency | undefined): number {
  return nonDefaultTokenBalances(data)
    .filter((token) => token.source !== "discovered" && token.available !== false)
    .reduce((sum, token) => {
      const amount = Number(formatAtomicAsDisplay(token.quantity, token.denomination, token.denomination));
      return sum + (valueFor(prices, currency, token.processId, amount)?.number ?? 0);
    }, 0);
}

export interface ListedTokenRow {
  key: string;
  label: string;
  defaultHidden: boolean;
  /** Set only on a token that Manage tokens can add back by id, so only those can be ignored. */
  processId?: string;
  node: ReactNode;
}

