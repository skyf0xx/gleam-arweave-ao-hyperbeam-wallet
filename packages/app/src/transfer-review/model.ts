import {
  WALLET_APPROVAL_ORIGIN,
  type CollectibleRef,
  type DeviceSigningSummary,
  type DisplayCurrency,
  type SigningApprovalPreview,
  type TokenBalance,
  type TokenPrice,
} from "@gleam/core";
import { otherTags } from "@gleam/core/src/ao/other-tags.ts";
import { COLLECTIBLE_TRANSFER_QUANTITY } from "@gleam/core/src/ao/collectible-transfer.ts";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
import { currencyStep, formatCurrencyValue, HIDDEN_AMOUNT } from "@gleam/ui/src/format/currency.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import type { WalletBalances } from "../screens/activity/src/useBalances";
import { displayTicker, formatAtomicAsDisplay, formatAtomicCompact, formatWinstonAsAr } from "../screens/main-screen/src/formatWinston";
import { shownTokenLogo, type RowVisibility } from "../token-visibility";
import type { TFunction } from "../i18n";
import { escapeHiddenCharacters } from "../approval/UntrustedText";

const AR_DENOMINATION = 12;

export type Tag = { name: string; value: string };

/** One value-moving transfer. Amounts are atomic strings: Winston for AR, the token's smallest unit otherwise. */
export interface TransferLine {
  /** `null` for AR, else the token's process id (or the collectible's asset id). */
  token: string | null;
  ticker: string | null;
  /** AR is always 12; `null` for a token whose scale didn't resolve. */
  denomination: number | null;
  amount: string;
  recipient: string;
  collectible?: CollectibleRef | null;
  /**
   * How many of the signed tags the headline's reader did not consume
   * (`core/ao/other-tags.ts`). Shown beside the amount, never only under
   * Details, so a tag the reader doesn't model is seen before approving.
   */
  otherTags?: number;
}

/** What one signed thing says beyond the transfer itself, shown under Details. */
export interface SignedPart {
  tags: Tag[];
  decodedData: string | null;
  /** `null` where nothing of the request's own is signed yet (a wallet send). */
  payloadHash: string | null;
}

export interface OtherItem extends SignedPart {
  target: string | null;
  payloadHash: string;
  /** This item is the token transfer the wallet couldn't read. */
  unreadableTokenTransfer?: boolean;
}

export interface TransferRequest {
  /** One per transfer, in signing order; never empty. */
  transfers: Array<TransferLine & { part: SignedPart; index: number }>;
  /** A batch's items that move nothing, shown as plain item cards. */
  others: Array<OtherItem & { index: number }>;
  /** AR the request pays, in Winston; `null` when it pays none. */
  fee: string | null;
  /** The provider method that asked; `null` for the wallet's own send, `undefined` when not known. */
  method?: string | null;
  itemCount: number;
  /**
   * Looks like a token transfer the wallet couldn't read, so it shows as the
   * plain transaction, warned. For a batch, set when any item is.
   */
  unreadableTokenTransfer?: boolean;
}

/**
 * Who might be at the other end of a send. `unchecked` is set when the
 * recipient lookup failed, so the box still shows rather than vouching for
 * an address nobody looked at.
 */
export interface RecipientRisk {
  firstTime: boolean;
  lookalikeOf: string | null;
  unchecked?: boolean;
}

/** What the screen knows about the signing wallet; every field is best effort. */
export interface TransferContext {
  /** The signing wallet's address, whose Show/Hide token choices pick the logos. */
  address?: string;
  balances?: WalletBalances;
  prices?: TokenPrice[];
  currency?: DisplayCurrency;
  tokenLogos?: boolean;
  balancesHidden?: boolean;
  visibility?: RowVisibility;
}

function line(
  token: string | null,
  ticker: string | null,
  denomination: number | null,
  amount: string,
  recipient: string,
  collectible?: CollectibleRef | null,
): TransferLine {
  return token === null
    ? { token: null, ticker: "AR", denomination: AR_DENOMINATION, amount, recipient, collectible }
    : { token, ticker, denomination, amount, recipient, collectible };
}

/**
 * The transfer layout's reading of a signing preview, or `null` when the
 * request moves nothing and keeps the generic screen. A single data item
 * that carries an AO transfer reads as that transfer, from the item's own
 * fields; a batch with any transfer item reads as a batch.
 */
export function transferRequestFromPreview(preview: SigningApprovalPreview): TransferRequest | null {
  const items = preview.items;
  if (items && items.some((item) => item.transfer !== null)) {
    if (preview.kind !== "signDataItem" && preview.kind !== "batchSignDataItem") return null;
    const transfers: TransferRequest["transfers"] = [];
    const others: TransferRequest["others"] = [];
    items.forEach((item, index) => {
      const part = { tags: item.tags, decodedData: item.decodedData, payloadHash: item.payloadHash };
      if (item.transfer) {
        const { token, tokenTicker, tokenDenomination, amount, recipient, collectible } = item.transfer;
        transfers.push({
          ...line(
            token,
            tokenTicker,
            tokenDenomination,
            collectible ? COLLECTIBLE_TRANSFER_QUANTITY : amount,
            recipient,
            collectible,
          ),
          otherTags: otherTags(item.tags, "ao").length,
          part,
          index,
        });
      } else {
        others.push({
          ...part,
          target: item.target,
          payloadHash: item.payloadHash,
          index,
          ...(item.unreadableTokenTransfer ? { unreadableTokenTransfer: true } : {}),
        });
      }
    });
    const unreadable = items.some((item) => item.unreadableTokenTransfer === true);
    return {
      transfers,
      others,
      fee: null,
      method: preview.kind,
      itemCount: items.length,
      ...(unreadable ? { unreadableTokenTransfer: true } : {}),
    };
  }
  if (preview.recipient === null || items) return null;
  const transfer = line(
    preview.collectible ? preview.collectible.id : preview.token,
    preview.tokenTicker,
    preview.tokenDenomination,
    preview.collectible ? "1" : (preview.amount ?? "0"),
    preview.recipient,
    preview.collectible,
  );
  const walletSend = preview.kind === "transfer";
  // A token or collectible headline is `readL1TokenTransfer`'s reading;
  // an AR one reads only the target and quantity.
  const reader = preview.collectible || preview.token !== null ? "l1" : "plain";
  return {
    transfers: [
      {
        ...transfer,
        otherTags: otherTags(preview.tags, reader).length,
        part: {
          tags: preview.tags,
          decodedData: preview.decodedData,
          payloadHash: walletSend ? null : preview.payloadHash,
        },
        index: 0,
      },
    ],
    others: [],
    fee: preview.fee,
    method: walletSend ? null : preview.kind,
    itemCount: 1,
    ...(preview.unreadableTokenTransfer ? { unreadableTokenTransfer: true } : {}),
  };
}

type TokenScale = { processId: string; denomination: number | null; ticker: string | null };

/**
 * The transfer layout's reading of what a device payload actually signs,
 * or `null` when any payload moves nothing. Scales only the token the
 * preview resolved; another target stays unscaled.
 */
export function transferRequestFromDevice(
  summaries: DeviceSigningSummary[],
  scale: TokenScale | undefined,
  collectible: CollectibleRef | null | undefined,
): TransferRequest | null {
  const transfers: TransferRequest["transfers"] = [];
  let fee: bigint | null = null;
  const addFee = (value: string) => {
    fee = (fee ?? 0n) + BigInt(value);
  };
  const empty: SignedPart = { tags: [], decodedData: null, payloadHash: null };
  for (const [index, summary] of summaries.entries()) {
    if (summary.kind === "transaction" && summary.recipient !== null) {
      transfers.push({ ...line(null, null, null, summary.quantity, summary.recipient), part: empty, index });
      addFee(summary.fee);
    } else if (summary.kind === "aoTransfer" || summary.kind === "l1TokenTransfer") {
      const known = scale?.processId === summary.process ? scale : undefined;
      // The device step re-reads the payload, so an AO transfer the preview
      // named as a collectible reads as one here too, not as raw units.
      const collectibleRef =
        summary.kind === "aoTransfer" &&
        collectible?.id === summary.process &&
        summary.quantity === COLLECTIBLE_TRANSFER_QUANTITY
          ? collectible
          : undefined;
      transfers.push({
        ...(collectibleRef
          ? line(summary.process, null, 0, COLLECTIBLE_TRANSFER_QUANTITY, summary.recipient, collectibleRef)
          : line(summary.process, known?.ticker ?? null, known?.denomination ?? null, summary.quantity, summary.recipient)),
        part: empty,
        index,
      });
      if (summary.kind === "l1TokenTransfer") addFee(summary.fee);
    } else if (summary.kind === "collectibleTransfer") {
      const ref = collectible?.id === summary.asset ? collectible : { id: summary.asset };
      transfers.push({ ...line(summary.asset, null, 0, "1", summary.recipient, ref), part: empty, index });
      addFee(summary.fee);
    } else {
      return null;
    }
  }
  if (transfers.length === 0) return null;
  const unreadable = summaries.some((summary) => summary.kind === "transaction" && summary.unreadableTokenTransfer === true);
  return {
    transfers,
    others: [],
    fee: fee === null ? null : String(fee),
    itemCount: summaries.length,
    ...(unreadable ? { unreadableTokenTransfer: true } : {}),
  };
}

/** Every transfer's distinct recipient, for the recipient checks. */
export function recipientsOf(request: TransferRequest): string[] {
  return [...new Set(request.transfers.map((transfer) => transfer.recipient))];
}

const NARROW_NBSP = " ";

/** `1500000` → `1 500 000`, grouped with narrow no-break spaces so it never wraps mid-number. */
export function groupDigits(atomic: string): string {
  return atomic.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
}

export function isUnknownScale(transfer: TransferLine): boolean {
  return !transfer.collectible && transfer.denomination === null;
}

/** The scaled amount, or the grouped raw one when the scale is unknown. */
export function amountText(transfer: TransferLine): string {
  if (transfer.collectible) return "1";
  if (transfer.denomination === null) return groupDigits(transfer.amount);
  if (transfer.token === null) return formatWinstonAsAr(transfer.amount, AR_DENOMINATION);
  return formatAtomicAsDisplay(transfer.amount, transfer.denomination, transfer.denomination);
}

/**
 * The amount's unit. A ticker that only echoes the process id back reads
 * as the shortened id; an unknown scale reads as raw units, since a
 * ticker with no confirmed scale misstates the amount.
 */
export function unitText(transfer: TransferLine, t: TFunction): string {
  if (transfer.token === null) return "AR";
  if (transfer.denomination === null) return t("transferReview.rawUnits");
  if (transfer.ticker !== null && transfer.ticker !== transfer.token) return displayTicker(transfer.ticker);
  return truncateAddress(transfer.token, 6);
}

/** The letters a token glyph shows without a logo. */
export function glyphLabel(transfer: TransferLine): string {
  if (transfer.token === null) return "AR";
  if (transfer.denomination === null || transfer.ticker === null || transfer.ticker === transfer.token) return "?";
  // Initials have no room for the `<U+XXXX>` form, so hidden characters are dropped instead.
  const visible = escapeHiddenCharacters(displayTicker(transfer.ticker)).filter((part) => typeof part === "string").join("");
  return visible.trim() === "" ? "?" : visible.slice(0, 2).toUpperCase();
}

/** A logo only for a token the wallet already lists, under the same rules as the token list. */
export function logoFor(transfer: TransferLine, context: TransferContext): string | undefined {
  if (!(context.tokenLogos ?? true) || transfer.collectible) return undefined;
  if (transfer.token === null) return DEFAULT_AR_TOKEN.logoUrl;
  if (transfer.denomination === null) return undefined;
  if (transfer.token === DEFAULT_AO_TOKEN.processId) return DEFAULT_AO_TOKEN.logoUrl;
  const balance = tokenBalance(context, transfer.token);
  return balance ? shownTokenLogo(balance, context.visibility ?? {}, true) : undefined;
}

function tokenBalance(context: TransferContext, processId: string): TokenBalance | undefined {
  return context.balances?.tokenBalances.find((balance) => balance.processId === processId && balance.available !== false);
}

function priceOf(context: TransferContext, transfer: TransferLine): number | undefined {
  if (transfer.collectible || transfer.denomination === null || !context.currency) return undefined;
  // A price in the token being sent would only repeat the amount.
  if (context.currency === (transfer.token === null ? "AR" : transfer.token === DEFAULT_AO_TOKEN.processId ? "AO" : null)) return undefined;
  const price = context.prices?.find((entry) => entry.processId === transfer.token)?.price;
  return typeof price === "number" ? price : undefined;
}

/** Display only: the value is an estimate, so a float is fine here. */
function fiatNumber(context: TransferContext, transfer: TransferLine): number | undefined {
  const price = priceOf(context, transfer);
  if (price === undefined || transfer.denomination === null) return undefined;
  return Number(formatAtomicAsDisplay(transfer.amount, transfer.denomination, transfer.denomination)) * price;
}

export function fiatText(context: TransferContext, transfer: TransferLine): string | undefined {
  const value = fiatNumber(context, transfer);
  return value === undefined || !context.currency ? undefined : approxCurrency(value, context.currency);
}

/** "≈ $1.20", or "< $0.01" for a value that would otherwise round to zero and read as worthless. */
function approxCurrency(value: number, currency: NonNullable<TransferContext["currency"]>): string {
  const step = currencyStep(value, currency);
  return value > 0 && value < step ? `< ${formatCurrencyValue(step, currency)}` : `≈ ${formatCurrencyValue(value, currency)}`;
}

/** The batch's total value, only when every transfer is priced. */
export function totalFiatText(context: TransferContext, transfers: TransferLine[]): string | undefined {
  const values = transfers.map((transfer) => fiatNumber(context, transfer));
  if (!context.currency || values.some((value) => value === undefined)) return undefined;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return approxCurrency(total, context.currency);
}

const FEE_SIGNIFICANT_DIGITS = 3n;

/**
 * The fee in AR to three significant digits, rounded up so it never reads
 * lower than what is paid; "None" for a request that pays none.
 */
export function feeText(fee: string | null, t: TFunction): string {
  if (fee === null) return t("transferReview.none");
  const winston = BigInt(fee);
  const digits = BigInt(winston.toString().length);
  const unit = digits > FEE_SIGNIFICANT_DIGITS ? 10n ** (digits - FEE_SIGNIFICANT_DIGITS) : 1n;
  const rounded = ((winston + unit - 1n) / unit) * unit;
  return `${formatWinstonAsAr(String(rounded), AR_DENOMINATION)} AR`;
}

/** The fee's value in the display currency, when AR is priced and isn't itself the display currency. */
export function feeFiatText(fee: string | null, context: TransferContext): string | undefined {
  if (fee === null || !context.currency || context.currency === "AR") return undefined;
  const price = context.prices?.find((entry) => entry.processId === null)?.price;
  if (typeof price !== "number") return undefined;
  return approxCurrency(Number(formatAtomicAsDisplay(fee, AR_DENOMINATION, AR_DENOMINATION)) * price, context.currency);
}

/** One token's balance after the request; `ticker` is the token's own, so it renders as untrusted text. */
export interface BalanceAfterPart {
  amount: string;
  ticker: string | null;
}

/**
 * What each sent token's balance will be once the request lands: AR also
 * pays the fee. A token whose balance isn't known is left out, and so is
 * one the request would overdraw, which the signing step refuses anyway.
 */
export function balanceAfterParts(context: TransferContext, request: TransferRequest): BalanceAfterPart[] | undefined {
  const balances = context.balances;
  if (!balances) return undefined;
  const spent = new Map<string | null, { transfer: TransferLine; total: bigint }>();
  for (const transfer of request.transfers) {
    if (transfer.collectible) continue;
    const entry = spent.get(transfer.token);
    spent.set(transfer.token, { transfer, total: (entry?.total ?? 0n) + BigInt(transfer.amount) });
  }
  if (request.fee !== null && spent.has(null)) {
    spent.get(null)!.total += BigInt(request.fee);
  }
  const parts: BalanceAfterPart[] = [];
  for (const [token, { transfer, total }] of spent) {
    const held = token === null ? balances.arBalance : tokenBalance(context, token)?.quantity;
    if (held === undefined || !/^\d+$/.test(held)) continue;
    const left = BigInt(held) - total;
    if (left < 0n) continue;
    if (context.balancesHidden) {
      parts.push({ amount: HIDDEN_AMOUNT, ticker: null });
    } else if (transfer.denomination === null) {
      parts.push({ amount: groupDigits(left.toString()), ticker: null });
    } else {
      const ticker = token === null ? "AR" : transfer.ticker !== null && transfer.ticker !== token ? displayTicker(transfer.ticker) : null;
      parts.push({ amount: formatAtomicCompact(left.toString(), transfer.denomination), ticker: ticker?.trim() ? ticker : null });
    }
  }
  return parts.length > 0 ? parts : undefined;
}

/** The reasons the warning box lists beyond the recipient's own. */
export function warningReasons(request: TransferRequest, t: TFunction): string[] {
  const reasons: string[] = [];
  if (request.unreadableTokenTransfer) reasons.push(t("transferReview.unreadableTokenTransfer"));
  if (request.transfers.some(isUnknownScale)) reasons.push(t("transferReview.unknownDecimals"));
  return reasons;
}

export function showsWarning(request: TransferRequest, risk: RecipientRisk | null): boolean {
  if (request.unreadableTokenTransfer || request.transfers.some(isUnknownScale)) return true;
  if (!risk) return false;
  return risk.firstTime || risk.lookalikeOf !== null || risk.unchecked === true;
}

/** The provider method behind a request, as Details names it. */
export function methodText(request: TransferRequest, t: TFunction): string | undefined {
  if (request.method === undefined) return undefined;
  return request.method ?? t("transferReview.walletSend");
}

/** The second line of an approval's header: what kind of request it is. */
export function requestTypeText(origin: string, request: TransferRequest, t: TFunction): string {
  if (request.transfers.length > 1) return t("transferReview.transfersCount", { count: request.transfers.length });
  if (request.transfers[0]?.collectible) return t("transferReview.sendCollectible");
  return origin === WALLET_APPROVAL_ORIGIN ? t("transferReview.send") : t("transferReview.transferRequest");
}
