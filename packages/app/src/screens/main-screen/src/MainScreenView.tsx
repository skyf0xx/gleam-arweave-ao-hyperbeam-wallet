import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { explorerUrlFor, isWatchWalletMethod, type ActivityEntry, type Collectible, type CollectibleRef, type DisplayCurrency, type PendingAmounts, type PortfolioHistoryRange, type PortfolioScope, type RuntimePort, type TokenBalance, type TokenPrice, type WalletSummary } from "@gleam/core";
import {
  DEFAULT_AO_TOKEN,
  DEFAULT_AR_TOKEN,
  PullToRefreshIndicator,
  usePullToRefresh,
} from "@gleam/ui";
import {
  AccountAvatar,
  ActivityRow,
  EmptyState,
  NetworkErrorBanner,
  PortfolioChart,
  SendReceiveActions,
  SkeletonRow,
  TokenRow,
} from "@gleam/ui/src/components/wallet/index.ts";
import { formatCurrencyValue, formatPercent, HIDDEN_AMOUNT } from "@gleam/ui/src/format/currency.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { displayTicker, formatAtomicAsDisplay, formatAtomicCompact, formatWinstonAsAr } from "./formatWinston";
import { useAddressIdentity } from "../../../address-identity";
import { useLocale, useT, type TFunction } from "../../../i18n";
import { useDisplaySettings } from "../../../display-settings";
import { useActivity } from "../../activity/src/useActivity";
import { useCollectibles } from "../../activity/src/useCollectibles";
import { CollectiblesGrid } from "../../collectibles/index.tsx";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { walletQueryKeys } from "../../activity/src/queryKeys";
import { usePortfolioHistory } from "./usePortfolioHistory";
import { useOtherWallets } from "../../activity/src/useOtherWallets";
import { useContacts } from "../../activity/src/useContacts";
import { ActivityDetailSheet, type ActivityDetail } from "./ActivityDetailSheet";
import { useOrderbookPrices, useTokenPrices } from "./useTokenPrices";
import { MainScreenNotice } from "./MainScreenNotice";
import { SiteWalletCard, type SiteWalletCardProps } from "../../site-wallet/index.tsx";
import { PointsTokenRow } from "../../points/index.tsx";
import { useCopy } from "../../points/src/useCopy";
import { readRowVisibility, shownTokenLogo, writeRowVisibility, type RowVisibility } from "../../../token-visibility";
import { relativeTime } from "../../../relative-time";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { CheckIcon, CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";

/**
 * Main screen: AR balance, AO token balances (empty until a "watch a
 * token" flow exists — see `handlers/reads.ts`'s doc comment), the merged
 * activity feed, the account pill's identity avatar, and the
 * total-portfolio-value chart with range tabs.
 *
 * Avatar: `AccountAvatar` (`packages/ui/src/components/wallet/
 * AccountAvatar.tsx`) renders SVG markup generated in-process by
 * `src/account-avatar.ts` (`@dicebear/core` + `@dicebear/styles`,
 * `shapes` style, seeded from the security phrase and `wallet.address`
 * through `useAddressIdentity`) — no network call.
 *
 * Chart: `PortfolioChart` (same directory) is fed by `usePortfolioHistory`
 * (`./usePortfolioHistory.ts`), a `useQuery` wrapping the same
 * `getPortfolioHistory` call (`ProtocolMap`, wired to `ReadsHandler`) via
 * `@gleam/core`'s `PortfolioHistoryRange` export — the shared-cache
 * pattern this screen's balances/activity already use. Switching a range
 * tab reads/fetches that range's own cache entry and updates the chart,
 * %-change badge, and period label together from one query response,
 * never a stale combination. An empty `series` (both price sources
 * unavailable) falls back to `NetworkErrorBanner`, matching the
 * balance/activity failure path, rather than a broken/blank chart.
 *
 * Display settings (`useDisplaySettings`): values are priced in the
 * chosen currency, the large figure is the total or the AR/AO balance,
 * the compact header swaps the full-width chart for a sparkline, and
 * tapping the large figure hides every balance on this screen until it's
 * tapped again.
 *
 * Tokens/Activity: a single tab control (local `activeTab` state, no
 * routing) switches between the two sections. The tab-button
 * visual/interaction pattern (`role="tablist"`/`"tab"`, `aria-selected`,
 * `bg-foreground text-background` for the active tab) is copied from
 * `PortfolioChart`'s existing range tabs above, on this same screen. The
 * Tokens tab renders the full, untruncated `state.tokenBalances` list;
 * the Activity tab caps at the most recent entries, names each counterparty
 * by its saved contact or own-wallet name, and opens `ActivityDetailSheet`
 * on a row's click. "View all" opens lunar.arweave.net's block explorer in
 * a new tab; there is no in-app full-list screen.
 *
 * Navigation entry points: the account pill's chevron opens the wallet
 * switcher via `onOpenWalletSwitcher`; the header's gear icon opens the
 * dedicated settings-home screen via `onOpenSettings`, which owns
 * navigation to every settings category (lock/auto-lock, connected apps,
 * network & peers, dark mode, and so on) — this component doesn't render
 * an inline settings menu or read/write theme preference itself.
 */
export type MainScreenTab = "tokens" | "collectibles" | "activity";

export interface MainScreenViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onSend: () => void;
  /**
   * Per-row entry point into the send flow for a specific AO token (the
   * top-level "Send" action in `SendReceiveActions` above stays AR-only —
   * it carries no token context to send with). Wired by `App.tsx` to open
   * `SendView` pre-selected for `token`, same sub-view kind as `onSend`.
   */
  onSendToken: (token: TokenBalance) => void;
  /** Opens send prefilled with `address`, for AR (`null`) or that token, from an activity entry's detail. */
  onSendTo?: (address: string, token: TokenBalance | null) => void;
  /** Where the activity detail sheet mounts (see `Sheet`'s `container`). */
  sheetContainer?: HTMLElement | null;
  onReceive: () => void;
  onOpenWalletSwitcher: () => void;
  onOpenSettings: () => void;
  onOpenPoints: () => void;
  /** Opens the dApp browser. Omitted where the host has none, which hides its button. */
  onOpenBrowser?: () => void;
  /** Opens the permissions screen for a site that was using another wallet. */
  onUseGleamOnSite: SiteWalletCardProps["onUseGleam"];
  onOpenCollectible: (collectible: Collectible) => void;
  /** Opens the add-token screen from the token list's edit mode. */
  onAddToken: () => void;
  /** Opens with the token list already in edit mode, as when coming back from add-token. */
  initialTokenEditing?: boolean;
  /** The tab to show on mount; the caller keeps it across detail screens that unmount this view. */
  initialTab?: MainScreenTab;
  onTabChange?: (tab: MainScreenTab) => void;
}

/**
 * A default (AR/AO) row carries enough to render a `TokenRow` and to be
 * clicked into the send flow: `"ar"` opens it for AR, a `TokenBalance`
 * for that AO token, and `null` leaves the row unclickable (an AO balance
 * that isn't loaded or couldn't be read).
 */
interface DefaultTokenRow {
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
const unavailableBalanceLabel = (t: TFunction): string => t("mainScreen.unavailable");

/** `0.2 sending`, `+0.5 arriving`, or both. With balances hidden the amounts go, and the words stay. */
function pendingNote(t: TFunction, pending: PendingAmounts | undefined, denomination: number, masked: boolean): string | null {
  if (!pending) return null;
  const notes: string[] = [];
  if (pending.outgoing !== "0") notes.push(masked ? t("mainScreen.sending") : t("mainScreen.sendingAmount", { amount: formatAtomicCompact(pending.outgoing, denomination) }));
  if (pending.incoming !== "0") notes.push(masked ? t("mainScreen.arriving") : t("mainScreen.arrivingAmount", { amount: formatAtomicCompact(pending.incoming, denomination) }));
  return notes.length > 0 ? notes.join(t("mainScreen.noteSeparator")) : null;
}

function withPendingNote(amount: string, note: string | null): ReactNode {
  if (note === null) return amount;
  return (
    <>
      {amount} · <span className="font-medium text-foreground gleam-cached-pulse">{note}</span>
    </>
  );
}

// The rest of the history is one click away through "View all".
const ACTIVITY_PREVIEW_LIMIT = 6;

/**
 * Looks up a token's price (by AO `processId`, or `null` for AR) from
 * `useTokenPrices()`'s cache and formats `amount * price` in the display
 * currency — `undefined` when the price isn't loaded yet or couldn't be
 * computed (`TokenPrice.price === null`, per that query's own HONESTY
 * contract), so `TokenRow` renders no value line rather than a fabricated
 * `$0.00`.
 */
function valueFor(
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

function unitPriceFor(
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

function changeFor(prices: TokenPrice[] | undefined, processId: string | null): number | undefined {
  return prices?.find((entry) => entry.processId === processId)?.change24h ?? undefined;
}

/**
 * Whether a query still shows data from before this screen opened.
 * Keyed on the data, not the status: a refetch that fails (status error) keeps the old data, and it stays old.
 */
function restoredCache(query: { data: unknown; dataUpdatedAt: number }, openedAt: number): boolean {
  return query.data !== undefined && query.dataUpdatedAt < openedAt;
}

/**
 * Builds the AR/AO default rows always shown at the top of the Tokens tab.
 * Reads straight off `useBalances()`'s cache: `undefined`
 * `data` (not yet loaded) or no matching `TokenBalance` entry both fall
 * back to `DEFAULT_TOKENS`' own `"0"` constant, never `null`/`undefined`.
 */
function buildDefaultTokenRows(
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
function nonDefaultTokenBalances(data: WalletBalances | undefined): TokenBalance[] {
  return (data?.tokenBalances ?? []).filter((token) => token.processId !== DEFAULT_AO_TOKEN.processId);
}

/**
 * The tokens worth asking an orderbook about: ones the user added, whose
 * balance resolved. A discovered token's name and logo are the sender's
 * claim, so its price would be too.
 */
function pricedTokenIds(data: WalletBalances | undefined): string[] {
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
function orderbookHoldingsValue(data: WalletBalances | undefined, prices: TokenPrice[] | undefined, currency: DisplayCurrency | undefined): number {
  return nonDefaultTokenBalances(data)
    .filter((token) => token.source !== "discovered" && token.available !== false)
    .reduce((sum, token) => {
      const amount = Number(formatAtomicAsDisplay(token.quantity, token.denomination, token.denomination));
      return sum + (valueFor(prices, currency, token.processId, amount)?.number ?? 0);
    }, 0);
}

/**
 * `ActivityEntry` carries only the AO token's processId, not its
 * denomination, so an AO entry's amount is scaled using the matching
 * live balance instead. Falls back to the raw atomic amount and a
 * shortened processId when no matching balance is loaded, rather than
 * mislabeling the entry as AR.
 *
 * A `match` whose `available` is `false` (`handlers/reads.ts`: failed
 * HyperBEAM read, or unconfirmed non-AO denomination) is treated the same
 * as no match — its `denomination` can't be trusted to scale
 * `entry.amount`, which would otherwise show the same guessed-by-orders-
 * of-magnitude number the "unavailable" state exists to prevent. Its
 * `ticker` is still used when resolved (not just an echoed process id),
 * since identity can be known even when the balance isn't.
 */
function formatActivityAmount(entry: { amount: string | null; token?: string | null }, tokenBalances: TokenBalance[] | undefined): string {
  if (entry.amount === null) return "—";
  if (!entry.token) return `${formatAtomicCompact(entry.amount, 12)} AR`;

  const match = tokenBalances?.find((token) => token.processId === entry.token);
  if (match && match.available !== false) {
    return `${formatAtomicCompact(entry.amount, match.denomination)} ${displayTicker(match.ticker)}`;
  }

  const ticker = match && match.ticker !== entry.token ? match.ticker : entry.token;
  return `${entry.amount} ${displayTicker(ticker)}`;
}

/**
 * A swap order names the asset by its ticker when the user added it, else
 * by a shortened process id: a discovered token's ticker is its own claim.
 */
function swapAssetLabel(processId: string, tokenBalances: TokenBalance[] | undefined): string {
  const match = tokenBalances?.find((token) => token.processId === processId);
  return match && match.source !== "discovered" && match.ticker !== processId ? displayTicker(match.ticker) : truncateAddress(processId, 6);
}

/** A gateway-only entry knows just the asset's process id. */
function collectibleLabel(t: TFunction, collectible: CollectibleRef): string {
  return collectible.name ?? t("mainScreen.collectible");
}

// A per-device view preference, so plain localStorage; it can throw or be empty in some contexts.
const PORTFOLIO_SCOPE_STORAGE_KEY = "gleam:portfolioScope";

function readPortfolioScope(): PortfolioScope {
  try {
    return window.localStorage.getItem(PORTFOLIO_SCOPE_STORAGE_KEY) === "all" ? "all" : "wallet";
  } catch {
    return "wallet";
  }
}

function writePortfolioScope(scope: PortfolioScope): void {
  try {
    window.localStorage.setItem(PORTFOLIO_SCOPE_STORAGE_KEY, scope);
  } catch {
    // Not persisting only means the next open starts on this wallet.
  }
}

const PORTFOLIO_RANGE_STORAGE_KEY = "gleam:portfolioRange";
const PORTFOLIO_RANGES: readonly PortfolioHistoryRange[] = ["24H", "7D", "1M", "1Y", "ALL"];

function readPortfolioRange(): PortfolioHistoryRange {
  try {
    const stored = window.localStorage.getItem(PORTFOLIO_RANGE_STORAGE_KEY);
    return PORTFOLIO_RANGES.find((range) => range === stored) ?? "7D";
  } catch {
    return "7D";
  }
}

function writePortfolioRange(range: PortfolioHistoryRange): void {
  try {
    window.localStorage.setItem(PORTFOLIO_RANGE_STORAGE_KEY, range);
  } catch {
    // Not persisting only means the next open starts on 7D.
  }
}

interface ListedTokenRow {
  key: string;
  label: string;
  defaultHidden: boolean;
  /** Set only on a token that Manage tokens can add back by id, so only those can be ignored. */
  processId?: string;
  node: ReactNode;
}

/** Scroll distance (px) past which the header collapses to its compact form. */
const HEADER_COLLAPSE_THRESHOLD_PX = 24;

/**
 * Header fade duration (ms) — also drives how long the tokens/activity
 * section waits before it detaches and floats to the top, so the two
 * motions read as sequential (fade, then float) rather than overlapping.
 * Kept as one constant so the JS delay and the CSS `duration-300` on the
 * header's opacity transition can't drift out of sync.
 */
const HEADER_FADE_DURATION_MS = 300;

/**
 * Resting `top` (px) for the docked tokens/activity section — matches the
 * pinned account-pill/settings row's rendered height (`top-16` below),
 * kept as one constant so the Tailwind class and the slide-in offset math
 * can't drift out of sync.
 */
const LIST_DOCK_TOP_PX = 64;

export function MainScreenView({
  runtime,
  wallet,
  onSend,
  onSendToken,
  onSendTo,
  sheetContainer = null,
  onReceive,
  onOpenWalletSwitcher,
  onOpenSettings,
  onOpenPoints,
  onOpenBrowser,
  onUseGleamOnSite,
  onOpenCollectible,
  onAddToken,
  initialTokenEditing = false,
  initialTab = "tokens",
  onTabChange,
}: MainScreenViewProps) {
  const t = useT();
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<MainScreenTab>(initialTab);
  const [openedAt] = useState(Date.now);
  // Discovery is slow, so it starts on first open rather than with the main screen.
  const [collectiblesOpened, setCollectiblesOpened] = useState(initialTab === "collectibles");
  const collectiblesQuery = useCollectibles(runtime, wallet.address, { enabled: collectiblesOpened });
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [listDocked, setListDocked] = useState(false);
  const [hiddenExpanded, setHiddenExpanded] = useState(initialTokenEditing);
  // Tagged with its address so a wallet switch reads that wallet's choices without an effect.
  const [storedVisibility, setStoredVisibility] = useState(() => ({
    address: wallet.address,
    rows: readRowVisibility(wallet.address),
  }));
  const rowVisibility =
    storedVisibility.address === wallet.address ? storedVisibility.rows : readRowVisibility(wallet.address);
  const isRowHidden = (row: ListedTokenRow) =>
    rowVisibility[row.key] === "hidden" || (rowVisibility[row.key] !== "shown" && row.defaultHidden);
  const toggleRowHidden = (row: ListedTokenRow) => {
    const rows: RowVisibility = { ...rowVisibility, [row.key]: isRowHidden(row) ? "shown" : "hidden" };
    setStoredVisibility({ address: wallet.address, rows });
    writeRowVisibility(wallet.address, rows);
  };
  const queryClient = useQueryClient();
  const [confirmingIgnore, setConfirmingIgnore] = useState<string | null>(null);
  const [ignoring, setIgnoring] = useState(false);
  const [ignoreFailed, setIgnoreFailed] = useState(false);
  const ignoreToken = async (processId: string) => {
    setIgnoring(true);
    setIgnoreFailed(false);
    try {
      await runtime.send<{ address: string; processId: string }, void>({
        type: "removeWatchedToken",
        payload: { address: wallet.address, processId },
      });
      // Dropped so a token added back by id isn't still filed under Hidden.
      const rows: RowVisibility = Object.fromEntries(Object.entries(rowVisibility).filter(([key]) => key !== processId));
      setStoredVisibility({ address: wallet.address, rows });
      writeRowVisibility(wallet.address, rows);
      setConfirmingIgnore(null);
      await queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances(wallet.address) });
    } catch {
      setIgnoreFailed(true);
    } finally {
      setIgnoring(false);
    }
  };
  const collapseRafRef = useRef<number | null>(null);
  const listSectionRef = useRef<HTMLDivElement>(null);
  const listDockOffsetRef = useRef(0);
  const balancesQuery = useBalances(runtime, wallet.address);
  const activityQuery = useActivity(runtime, wallet.address);
  const { settings: displaySettings, update: updateDisplaySettings } = useDisplaySettings(runtime);
  const currency = displaySettings?.currency;
  const headerStyle = displaySettings?.header ?? "full";
  const simpleRows = displaySettings?.tokenRows === "simple";
  const tokenLogos = displaySettings?.tokenLogos ?? true;
  const masked = displaySettings?.balancesHidden ?? false;
  const watchOnly = isWatchWalletMethod(wallet.method);
  const toggleMasked = () => void updateDisplaySettings({ balancesHidden: !masked });
  const tokenPricesQuery = useTokenPrices(runtime, currency);
  const orderbookPricesQuery = useOrderbookPrices(runtime, currency, pricedTokenIds(balancesQuery.data));
  const tokenPrices = tokenPricesQuery.data ? [...tokenPricesQuery.data, ...(orderbookPricesQuery.data ?? [])] : undefined;
  const hasLoadedOnce = balancesQuery.isSuccess || activityQuery.isSuccess;
  const loading = balancesQuery.isLoading || activityQuery.isLoading;
  const loadError = balancesQuery.error ?? activityQuery.error ?? null;
  const [selectedRange, setSelectedRange] = useState<PortfolioHistoryRange>(readPortfolioRange);
  const selectRange = (range: PortfolioHistoryRange) => {
    setSelectedRange(range);
    writePortfolioRange(range);
  };
  const otherWalletsQuery = useOtherWallets(runtime, wallet.id);
  const hasOtherWallets = (otherWalletsQuery.data?.length ?? 0) > 0;
  const contactsQuery = useContacts(runtime);
  const nameFor = (address: string): string | undefined =>
    contactsQuery.data?.find((contact) => contact.address === address)?.name ??
    otherWalletsQuery.data?.find((other) => other.address === address)?.name;
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  // A send is offered only for AR or a token whose balance (and so denomination) is loaded.
  const sendableToken = (entry: ActivityEntry): TokenBalance | null | undefined => {
    if (entry.collectible || entry.swap || entry.type === "upload") return undefined;
    if (!entry.token) return null;
    const match = balancesQuery.data?.tokenBalances.find((token) => token.processId === entry.token);
    return match && match.available !== false ? match : undefined;
  };
  const [preferredScope, setPreferredScope] = useState<PortfolioScope>(readPortfolioScope);
  // With a single wallet "all" equals "wallet"; resolving it here keeps one cache entry and no toggle.
  const portfolioScope: PortfolioScope = hasOtherWallets ? preferredScope : "wallet";
  const togglePortfolioScope = () => {
    const next: PortfolioScope = portfolioScope === "all" ? "wallet" : "all";
    setPreferredScope(next);
    writePortfolioScope(next);
  };
  // Waits for the wallet list so a saved "all" preference doesn't first fetch the single-wallet view.
  const portfolioHistoryQuery = usePortfolioHistory(runtime, wallet.address, selectedRange, portfolioScope, currency, {
    enabled: !otherWalletsQuery.isPending,
  });
  // A refetch of a query that never had data resets it to pending and drops the error, which would take the banner
  // down mid-retry; this keeps it up until that retry settles. Keyed so switching range doesn't carry it over.
  const portfolioKey = `${wallet.address}|${selectedRange}|${portfolioScope}|${currency}`;
  const [portfolioRetryKey, setPortfolioRetryKey] = useState<string | null>(null);
  const portfolioRetrying = portfolioRetryKey === portfolioKey;
  const portfolioFailed =
    portfolioRetrying || portfolioHistoryQuery.isError || (portfolioHistoryQuery.isSuccess && portfolioHistoryQuery.data.series.length === 0);
  const retryPortfolio = () => {
    setPortfolioRetryKey(portfolioKey);
    void portfolioHistoryQuery.refetch().finally(() => setPortfolioRetryKey((key) => (key === portfolioKey ? null : key)));
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const pullState = usePullToRefresh({
    target: rootRef,
    onRefresh: () =>
      Promise.allSettled([
        balancesQuery.refetch(),
        activityQuery.refetch(),
        tokenPricesQuery.refetch(),
        portfolioHistoryQuery.refetch(),
        ...(collectiblesOpened ? [collectiblesQuery.refetch()] : []),
      ]),
  });

  const defaultTokenRows = buildDefaultTokenRows(t, balancesQuery.data, tokenPrices, currency);
  const tokensCached = restoredCache(balancesQuery, openedAt) || restoredCache(tokenPricesQuery, openedAt);
  const collectiblesCached = restoredCache(collectiblesQuery, openedAt);
  const activityCached = restoredCache(activityQuery, openedAt);
  // The total waits for every input, so it ticks once instead of once per query.
  const tokensFetching = balancesQuery.isFetching || tokenPricesQuery.isFetching;
  const chartFetching = tokensFetching || portfolioHistoryQuery.isFetching;
  const chartCached = tokensCached || restoredCache(portfolioHistoryQuery, openedAt);
  const portfolioHasSeries = (portfolioHistoryQuery.data?.series.length ?? 0) > 0;
  // Only the open wallet's tokens are known here, so the all-wallets total is left as the chart has it.
  const history = portfolioHistoryQuery.data;
  const extraValue =
    portfolioScope === "wallet" && history !== undefined && history.series.length > 0
      ? orderbookHoldingsValue(balancesQuery.data, tokenPrices, currency)
      : 0;
  const chartSeries =
    history && extraValue > 0 ? history.series.map((point) => ({ ...point, value: point.value + extraValue })) : (history?.series ?? []);
  const chartFirst = chartSeries[0]?.value ?? 0;
  const chartLast = chartSeries[chartSeries.length - 1]?.value ?? 0;
  const chartChange = !history ? 0 : extraValue > 0 && chartSeries.length > 1 && chartFirst > 0 ? chartLast / chartFirst - 1 : history.change;
  const headlineRow =
    displaySettings?.headline === "AR" ? defaultTokenRows[0] : displaySettings?.headline === "AO" ? defaultTokenRows[1] : undefined;

  const identity = useAddressIdentity();
  const avatarSvg = identity.avatarSvg(wallet.address);
  const { copied: addressCopied, copy: copyAddress } = useCopy(wallet.address);

  /**
   * Chrome renders the popup as one continuously-growing box past its
   * 600px ceiling (see theme.css's `[data-layout="popup"]` comment) —
   * there's no inner scroll container, so `window.scrollY` is the only
   * scroll position that exists here. Fades the header (chart,
   * actions) once scrolled down past it, and un-fades on scrolling back up
   * to the top rather than on scroll direction generally — matching the
   * reference apps this is feature-matched against, where the compact
   * header state tracks "am I still at the top", not "did the last
   * gesture go up or down". The boolean flip itself is deferred to a
   * `requestAnimationFrame` (via a ref, not state) so a burst of scroll
   * events triggers at most one state update per frame instead of one per
   * event.
   */
  useEffect(() => {
    const handleScroll = () => {
      if (collapseRafRef.current !== null) return;
      collapseRafRef.current = requestAnimationFrame(() => {
        collapseRafRef.current = null;
        setHeaderCollapsed(window.scrollY > HEADER_COLLAPSE_THRESHOLD_PX);
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (collapseRafRef.current !== null) cancelAnimationFrame(collapseRafRef.current);
    };
  }, []);

  /**
   * Once the header has fully faded out, the tokens/activity section
   * detaches from document flow (`position: fixed`) and slides up to sit
   * flush under the account-pill/settings row — "floating" over the
   * now-invisible header rather than the header itself shrinking. Docking
   * is deferred until the fade transition ends (`HEADER_FADE_DURATION_MS`)
   * so the two motions read as sequential instead of overlapping, and
   * un-docks immediately on scrolling back up so the section returns to
   * flow before the header starts fading back in. The measured offset is
   * relative to the docked resting position (`LIST_DOCK_TOP_PX`, where
   * `top` lands once fixed), not the viewport top, so the slide covers
   * exactly the remaining distance instead of overshooting by however
   * tall the pinned header row is.
   */
  useEffect(() => {
    if (!headerCollapsed) {
      setListDocked(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const rect = listSectionRef.current?.getBoundingClientRect();
      listDockOffsetRef.current = rect ? rect.top - LIST_DOCK_TOP_PX : 0;
      setListDocked(true);
    }, HEADER_FADE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [headerCollapsed]);

  /**
   * Back at the top, the home screen shows Tokens again, with the hidden
   * tokens disclosure collapsed. Only an expand after a collapse counts, so
   * a remount on a tab the caller restored (returning from a detail screen)
   * keeps that tab.
   */
  const wasCollapsedRef = useRef(false);
  useEffect(() => {
    if (headerCollapsed) {
      wasCollapsedRef.current = true;
      return;
    }
    if (!wasCollapsedRef.current) return;
    wasCollapsedRef.current = false;
    setActiveTab("tokens");
    setHiddenExpanded(false);
    onTabChange?.("tokens");
    // onTabChange is deliberately left out: only the collapse flip should reset the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerCollapsed]);

  /**
   * Scrolls the window until the list section reaches its docked position,
   * so the header fades, the section docks, and the whole list has the
   * popup to itself. Once docked, the section scrolls on its own, so this
   * just brings that inner list back to its top. Shared by tab switches and
   * by expanding the hidden-tokens disclosure, which both want the list in
   * full view rather than scrolled to wherever the click happened.
   */
  const scrollListToDockedTop = () => {
    const section = listSectionRef.current;
    if (!section) return;
    const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (listDocked) {
      section.scrollTo?.({ top: 0, behavior });
      return;
    }
    const top = window.scrollY + section.getBoundingClientRect().top - LIST_DOCK_TOP_PX;
    window.scrollTo({ top: Math.max(top, HEADER_COLLAPSE_THRESHOLD_PX + 1), behavior });
  };

  const selectTab = (tab: MainScreenTab) => {
    setActiveTab(tab);
    if (tab === "collectibles") setCollectiblesOpened(true);
    onTabChange?.(tab);
    scrollListToDockedTop();
  };

  const toggleHiddenExpanded = () => {
    setHiddenExpanded((prev) => !prev);
    scrollListToDockedTop();
  };

  useEffect(() => {
    if (initialTokenEditing) scrollListToDockedTop();
    // Mount only: put the list where toggling edit mode leaves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Scrolling to the top un-collapses the header, which un-docks the list and fades the chart back in. */
  const returnHome = () => {
    const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    listSectionRef.current?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0, behavior });
  };

  useBackHandler(
    confirmingIgnore !== null ? () => setConfirmingIgnore(null) : headerCollapsed ? returnHome : null,
  );

  return (
    <div ref={rootRef} className="flex min-h-full flex-col">
      {loadError ? (
        <NetworkErrorBanner
          onRetry={() => {
            void balancesQuery.refetch();
            void activityQuery.refetch();
          }}
          retrying={balancesQuery.isFetching || activityQuery.isFetching}
        />
      ) : null}

      <div className="sticky top-[var(--inset-top)] z-30 flex items-center justify-between gap-2.5 bg-background px-5 pb-2.5 pt-4 phone:h-16 phone:py-0">
        {headerCollapsed ? (
          // h-9 matches the account pill's height so the row, and the list docked under it, don't shift.
          <button
            type="button"
            aria-label={t("mainScreen.back")}
            onClick={returnHome}
            className="-ml-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground phone:-ml-3 phone:h-11 phone:w-11"
          >
            <BackIcon />
          </button>
        ) : (
          // The copy button can't nest inside the pill's button, so the wrapper carries the shared hover background.
          <div className="group -ml-3 flex min-w-0 items-center rounded-lg pr-1 hover:bg-mist phone:ml-0 phone:pr-0">
            <button
              type="button"
              onClick={onOpenWalletSwitcher}
              aria-haspopup="dialog"
              aria-label={t("mainScreen.accountDetails", { name: wallet.name, address: wallet.address })}
              className="flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-0 pr-1 phone:min-h-11 phone:gap-2.5"
            >
              <AccountAvatar svgMarkup={avatarSvg} label={t("mainScreen.avatarOf", { name: wallet.name })} size={24} />
              <span className="truncate text-label">{wallet.name}</span>
              <span className="truncate font-mono text-label text-faint">
                {truncateAddress(wallet.address, 6)}
              </span>
            </button>
            <button
              type="button"
              onClick={copyAddress}
              aria-label={addressCopied ? t("mainScreen.addressCopied") : t("mainScreen.copyAddress")}
              title={addressCopied ? t("mainScreen.copied") : t("mainScreen.copyAddress")}
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-opacity focus-visible:opacity-100 group-hover:opacity-100 phone:opacity-100 phone:hit-target ${addressCopied ? "text-positive opacity-100" : "text-muted opacity-0 hover:text-foreground"}`}
            >
              {addressCopied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        )}

        {headerCollapsed && history && !portfolioFailed ? (
          // The range tabs fade out with the chart, so the range rides along to say what the change covers.
          <button
            type="button"
            onClick={returnHome}
            className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 text-label tabular-nums text-muted phone:min-h-11 phone:items-center"
          >
            <span className="truncate font-semibold text-foreground">
              {masked ? HIDDEN_AMOUNT : formatCurrencyValue(history.currentValue + extraValue, currency ?? "USD", locale)}
            </span>{" "}
            <span className="font-semibold" style={{ color: chartChange >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}>
              {formatPercent(chartChange, locale)}
            </span>{" "}
            <span>{selectedRange}</span>
          </button>
        ) : null}

        <div className="flex flex-shrink-0 items-center phone:-mr-3">
          {onOpenBrowser ? (
            <button
              type="button"
              aria-label={t("mainScreen.browser")}
              onClick={onOpenBrowser}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground phone:h-11 phone:w-11"
            >
              <GlobeIcon />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={t("mainScreen.settings")}
            onClick={onOpenSettings}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground phone:h-11 phone:w-11"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      <PullToRefreshIndicator {...pullState} />

      <SiteWalletCard runtime={runtime} onUseGleam={onUseGleamOnSite} />
      <MainScreenNotice runtime={runtime} wallet={wallet} onOpenPoints={onOpenPoints} />

      {/*
        Fades the chart block toward invisible on scroll. Its
        space stays reserved in the layout at all times — only opacity
        transitions — and the chart's own fetch/range state stays alive
        underneath, so re-expanding never re-fetches or resets the range
        tab.
      */}
      <div className="transition-opacity duration-300 ease-out" style={{ opacity: headerCollapsed ? 0 : 1 }}>
        <div inert={headerCollapsed}>
          <div className="-mt-1 px-6 phone:mt-0 phone:px-5 phone:pb-1 phone:pt-1">
            <PortfolioChart
              points={chartSeries}
              currentValue={history ? history.currentValue + extraValue : 0}
              currency={currency ?? "USD"}
              change={chartChange}
              periodLabel={portfolioHistoryQuery.data?.periodLabel ?? ""}
              activeRange={selectedRange}
              onRangeChange={selectRange}
              scope={portfolioScope}
              onToggleScope={hasOtherWallets ? togglePortfolioScope : undefined}
              headline={
                headlineRow
                  ? headlineRow.amount === unavailableBalanceLabel(t)
                    ? { amount: t("mainScreen.unavailableTicker", { ticker: headlineRow.ticker }) }
                    : { amount: headlineRow.amount, unit: headlineRow.ticker, value: headlineRow.amountNumber }
                  : undefined
              }
              masked={masked}
              onToggleMasked={displaySettings ? toggleMasked : undefined}
              layout={headerStyle}
              loading={portfolioHistoryQuery.isPending || (portfolioHistoryQuery.isFetching && !portfolioHasSeries)}
              cached={chartCached}
              cachedFetching={chartFetching}
              walletKey={wallet.id}
              /**
               * `series: []` on a *resolved* response (no thrown query
               * error) is `getPortfolioHistory`'s own signal that both AR
               * price sources failed (`reads.ts`'s doc comment) — a real
               * zero-balance wallet still gets a non-empty series (AR/USD
               * prices exist independent of the user's balance, just
               * every point's `value` is 0), so an empty series here
               * only ever means the fetch effectively failed. Passed
               * through as `onRetry` rather than swapping `PortfolioChart`
               * out for `NetworkErrorBanner` at this level, so the range
               * tabs (rendered inside `PortfolioChart`) stay visible and
               * clickable even while the active range is failed — a
               * failed "ALL" no longer strands the user without a way
               * back to a previously-cached "7D". The banner stays up
               * through a retry with `retrying` set, so the tap visibly
               * does something even when the retry fails again at once.
               * A series already on screen stays through a refetch,
               * marked by `cached`.
               */
              onRetry={portfolioFailed ? retryPortfolio : undefined}
              retrying={portfolioFailed && portfolioHistoryQuery.isFetching}
            />
          </div>

          <div className="px-6 pb-6 pt-3 phone:px-5 phone:pb-4 phone:pt-2">
            <Beam />
          </div>

          <div className="px-6 pb-5 phone:px-5 phone:pb-4">
            <SendReceiveActions
              onSend={onSend}
              onReceive={onReceive}
              sendDisabled={watchOnly}
              compact={headerStyle !== "full"}
            />
          </div>
        </div>
      </div>

      {/*
        Once docked (see the effect above), this section leaves document
        flow and floats fixed just beneath the pinned account-pill/settings
        row (`top-16`/`LIST_DOCK_TOP_PX`, not the literal viewport top),
        sliding up from its natural scroll position via `transform` rather
        than animating `top` — transform/opacity are what the compositor
        can animate without triggering layout on every frame. A same-sized
        placeholder takes its place in flow so nothing below it (there is
        nothing below it today, but this keeps the section self-contained)
        jumps when it detaches. `--dock-offset` carries the measured
        distance still remaining to that resting `top` at the moment of
        detaching, so the transform can start exactly where the section
        already was and animate down to 0 instead of snapping. Docked, it
        runs to the popup's bottom edge and scrolls internally — a fixed
        box can't be moved by window scroll, so without that a list longer
        than the popup would be cut off. The undocked min-height keeps the
        page tall enough for a swipe or a tab click to scroll the section all
        the way up to its docked position even when the list is short.
      */}
      {listDocked ? <div style={{ height: listSectionRef.current?.offsetHeight }} /> : null}
      <div
        ref={listSectionRef}
        className={`px-6 pb-6 phone:px-5 phone:pb-4 phone:[@media(max-height:700px)]:pb-2 ${
          listDocked
            ? "gleam-dock-in fixed inset-x-0 bottom-0 top-[calc(4rem+var(--inset-top))] z-20 mx-auto max-w-[var(--content-max)] overflow-y-auto bg-background"
            : "min-h-[calc(100dvh-4rem)]"
        }`}
        style={listDocked ? ({ "--dock-offset": `${listDockOffsetRef.current}px` } as CSSProperties) : undefined}
      >
        <div
          role="tablist"
          aria-label={t("mainScreen.tabsLabel")}
          className="sticky top-0 z-10 flex items-center gap-1 bg-background pb-2.5 pt-1 phone:-mx-2.5 phone:pb-1 phone:pt-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tokens"}
            onClick={() => selectTab("tokens")}
            className={`rounded-md px-2.5 py-1 text-label phone:hit-target ${
              activeTab === "tokens" ? "bg-mist text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {t("mainScreen.tabTokens")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "collectibles"}
            onClick={() => selectTab("collectibles")}
            className={`rounded-md px-2.5 py-1 text-label phone:hit-target ${
              activeTab === "collectibles" ? "bg-mist text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {t("mainScreen.tabCollectibles")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            onClick={() => selectTab("activity")}
            className={`rounded-md px-2.5 py-1 text-label phone:hit-target ${
              activeTab === "activity" ? "bg-mist text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {t("mainScreen.tabActivity")}
          </button>
        </div>

        {activeTab === "tokens" ? (
          <div className="min-h-60 phone:min-h-0">
            {loading && !hasLoadedOnce ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              (() => {
                const rows: ListedTokenRow[] = [
                  ...defaultTokenRows.map(({ send, ...row }) => ({
                    key: row.key,
                    label: row.name,
                    defaultHidden: false,
                    node: (
                      <TokenRow
                        glyph={{ label: row.ticker.slice(0, 2).toUpperCase(), tone: 2, logoUrl: tokenLogos ? row.logoUrl : undefined }}
                        name={row.name}
                        amount={withPendingNote(masked ? HIDDEN_AMOUNT : row.amount, pendingNote(t, row.pending, 12, masked))}
                        value={
                          row.value === undefined ? undefined : masked ? HIDDEN_AMOUNT : row.value.text
                        }
                        // `amount @ price` would give the hidden holding away.
                        unitPrice={masked || simpleRows ? undefined : row.unitPrice}
                        change={simpleRows ? undefined : row.change}
                        loading={loading}
                        cached={tokensCached}
                        cachedFetching={tokensFetching}
                        onClick={send === null || watchOnly ? undefined : send === "ar" ? onSend : () => onSendToken(send)}
                        className="border-b-0"
                      />
                    ),
                  })),
                  {
                    key: "gleam-points",
                    label: "Gleam Points",
                    defaultHidden: false,
                    node: <PointsTokenRow runtime={runtime} wallet={wallet} onOpen={onOpenPoints} showLogo={tokenLogos} className="border-b-0" />,
                  },
                  ...nonDefaultTokenBalances(balancesQuery.data).map((token) => {
                    const discovered = token.source === "discovered";
                    const amountNumber =
                      token.available === false ? 0 : Number(formatAtomicAsDisplay(token.quantity, token.denomination, token.denomination));
                    const value = discovered || token.available === false ? undefined : valueFor(tokenPrices, currency, token.processId, amountNumber);
                    return {
                      key: token.processId,
                      label: displayTicker(token.ticker),
                      processId: token.processId,
                      // Anyone can send a token, so one the user didn't add starts hidden.
                      defaultHidden: discovered,
                      node: (
                        <TokenRow
                          glyph={{
                            label: token.ticker.slice(0, 2).toUpperCase(),
                            tone: 2,
                            logoUrl: shownTokenLogo(token, rowVisibility, tokenLogos),
                          }}
                          name={displayTicker(token.ticker)}
                          amount={
                            token.available === false
                              ? unavailableBalanceLabel(t)
                              : withPendingNote(
                                  masked ? HIDDEN_AMOUNT : formatAtomicCompact(token.quantity, token.denomination),
                                  pendingNote(t, token.pending, token.denomination, masked),
                                )
                          }
                          value={value === undefined ? undefined : masked ? HIDDEN_AMOUNT : value.text}
                          unitPrice={masked || simpleRows || value === undefined ? undefined : unitPriceFor(tokenPrices, currency, token.processId, token.ticker, amountNumber)}
                          change={simpleRows || value === undefined ? undefined : changeFor(tokenPrices, token.processId)}
                          loading={loading}
                          cached={tokensCached}
                          cachedFetching={tokensFetching}
                          onClick={token.available === false || watchOnly ? undefined : () => onSendToken(token)}
                          className="border-b-0"
                        />
                      ),
                    };
                  }),
                ].sort((a, b) => a.label.localeCompare(b.label, locale, { sensitivity: "base" }));
                const hiddenRows = rows.filter(isRowHidden);
                const renderRow = (row: ListedTokenRow) => {
                  const hidden = isRowHidden(row);
                  const { processId } = row;
                  if (processId !== undefined && confirmingIgnore === processId) {
                    return (
                      <div key={row.key} className="flex flex-col gap-2 px-3.5 py-3 phone:px-0">
                        <p className="text-caption leading-relaxed text-muted">
                          {t("mainScreen.ignoreConfirm", { label: row.label })}
                        </p>
                        {ignoreFailed ? (
                          <p role="alert" className="text-caption text-warning">
                            {t("mainScreen.ignoreFailed")}
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-3 text-caption font-semibold">
                          <button
                            type="button"
                            onClick={() => setConfirmingIgnore(null)}
                            className="text-muted hover:text-foreground"
                          >
                            {t("mainScreen.cancel")}
                          </button>
                          <button
                            type="button"
                            disabled={ignoring}
                            onClick={() => void ignoreToken(processId)}
                            className="text-warning disabled:opacity-60"
                          >
                            {ignoring ? t("mainScreen.ignoring") : t("mainScreen.ignore")}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  const actionClassName =
                    "rounded-md bg-mist px-2 py-1 text-caption font-semibold text-muted hover:text-foreground phone:flex phone:min-h-11 phone:items-center phone:px-3.5";
                  return (
                    <div key={row.key} data-editing={hiddenExpanded || undefined} className="group relative">
                      {row.node}
                      {hiddenExpanded ? (
                        <div className="absolute right-3.5 top-1/2 flex -translate-y-1/2 gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 phone:right-0 phone:opacity-100">
                          {hidden && processId !== undefined ? (
                            <button
                              type="button"
                              aria-label={t("mainScreen.ignoreLabel", { label: row.label })}
                              onClick={() => {
                                setIgnoreFailed(false);
                                setConfirmingIgnore(processId);
                              }}
                              className={actionClassName}
                            >
                              {t("mainScreen.ignore")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={t(hidden ? "mainScreen.showLabel" : "mainScreen.hideLabel", { label: row.label })}
                            onClick={() => toggleRowHidden(row)}
                            className={actionClassName}
                          >
                            {hidden ? t("mainScreen.show") : t("mainScreen.hide")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                };
                const addTokenRow = hiddenExpanded ? (
                  <button
                    type="button"
                    onClick={onAddToken}
                    className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-mist phone:gap-3 phone:px-0 phone:py-3.5 phone:active:bg-mist"
                  >
                    <span aria-hidden="true" className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg border border-line bg-background text-foreground">
                      <PlusIcon />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="text-label font-semibold text-foreground">{t("mainScreen.addToken")}</span>
                      <span className="text-caption text-muted">{t("mainScreen.addTokenHint")}</span>
                    </span>
                    <span aria-hidden="true" className="flex-shrink-0 text-faint">
                      <ChevronRightIcon />
                    </span>
                  </button>
                ) : null;
                return (
                  <>
                    {rows.filter((row) => !isRowHidden(row)).map(renderRow)}
                    {hiddenRows.length > 0 ? (
                      <>
                        <button
                          type="button"
                          aria-expanded={hiddenExpanded}
                          onClick={toggleHiddenExpanded}
                          className="flex w-full items-center justify-between px-3.5 py-3 text-label text-muted hover:text-foreground phone:min-h-11 phone:px-0"
                        >
                          <span>{t("mainScreen.hiddenCount", { count: hiddenRows.length })}</span>
                          <ChevronIcon open={hiddenExpanded} />
                        </button>
                        {hiddenExpanded ? hiddenRows.map(renderRow) : null}
                        {addTokenRow}
                      </>
                    ) : listDocked || hiddenExpanded ? (
                      // With nothing hidden there's no accordion to open, so this is the way into Show/Hide.
                      <>
                        {addTokenRow}
                        <button
                          type="button"
                          onClick={() => setHiddenExpanded((prev) => !prev)}
                          className={`px-3.5 py-3 text-caption text-muted hover:text-foreground phone:flex phone:min-h-11 phone:items-center phone:px-0 phone:text-label ${hiddenExpanded ? "ml-auto block w-fit" : ""}`}
                        >
                          {hiddenExpanded ? t("mainScreen.done") : t("mainScreen.editList")}
                        </button>
                      </>
                    ) : null}
                  </>
                );
              })()
            )}
          </div>
        ) : activeTab === "collectibles" ? (
          <div
            className={`min-h-60 pt-3.5 transition-opacity duration-500 ease-out phone:min-h-0 phone:pt-1 ${
              collectiblesCached ? (collectiblesQuery.isFetching ? "gleam-cached-pulse" : "opacity-70") : ""
            }`}
          >
            {collectiblesQuery.error && !collectiblesQuery.data ? (
              <NetworkErrorBanner onRetry={() => void collectiblesQuery.refetch()} className="phone:mx-0 phone:mt-0" />
            ) : (
              <CollectiblesGrid
                items={collectiblesQuery.data}
                loading={collectiblesQuery.isLoading}
                onOpen={onOpenCollectible}
              />
            )}
          </div>
        ) : (
          <>
            <div
              className={`min-h-60 transition-opacity duration-500 ease-out phone:min-h-0 ${
                activityCached ? (activityQuery.isFetching ? "gleam-cached-pulse" : "opacity-70") : ""
              }`}
            >
              {loading && !hasLoadedOnce ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : !activityQuery.data || activityQuery.data.entries.length === 0 ? (
                <EmptyState message={t("mainScreen.noActivity")} />
              ) : (
                activityQuery.data.entries.slice(0, ACTIVITY_PREVIEW_LIMIT).map((entry) => {
                  const title =
                      entry.swap
                        ? t("mainScreen.swapOrder", { asset: swapAssetLabel(entry.swap.process, balancesQuery.data?.tokenBalances) })
                        : entry.type === "upload" && !entry.collectible
                        ? uploadTitle(t, entry)
                        : activityTitle(
                            t,
                            entry.type,
                            entry.collectible ? collectibleLabel(t, entry.collectible) : (nameFor(entry.address) ?? truncateAddress(entry.address, 6)),
                            Boolean(entry.collectible),
                          );
                  const subtitle =
                      entry.swap && entry.status === "confirmed"
                        ? entry.timestamp > 0
                          ? t("mainScreen.orderPlacedAt", { time: relativeTime(t, entry.timestamp) })
                          : t("mainScreen.orderPlaced")
                        : entry.unverified
                        ? entry.timestamp > 0
                          ? t("mainScreen.unverifiedTransferAt", { time: relativeTime(t, entry.timestamp) })
                          : t("mainScreen.unverifiedTransfer")
                        : entry.status === "pending"
                        ? t("mainScreen.pendingConfirmation")
                        : entry.status === "failed"
                          ? entry.error
                            ? t("mainScreen.failedWithError", { error: entry.error })
                            : t("mainScreen.failed")
                          : relativeTime(t, entry.timestamp);
                  const amountLabel = entry.amount
                    ? `${entry.type === "receive" ? "+" : "-"}${formatActivityAmount(entry, balancesQuery.data?.tokenBalances)}`
                    : entry.dataSize
                      ? formatDataSize(entry.dataSize, locale)
                      : undefined;
                  const token = sendableToken(entry);
                  return (
                  <ActivityRow
                    key={entry.txId}
                    activityType={entry.swap ? "swap" : entry.type}
                    title={title}
                    subtitle={subtitle}
                    amountLabel={amountLabel}
                    outcomeUnknown={Boolean(entry.swap)}
                    amountTone={entry.type === "send" && entry.status !== "failed" ? "negative" : entry.type === "receive" && !entry.unverified ? "positive" : "neutral"}
                    collectible={
                      entry.collectible
                        ? { name: collectibleLabel(t, entry.collectible), imageUrl: entry.collectible.imageUrl }
                        : undefined
                    }
                    pending={entry.status === "pending"}
                    onClick={() =>
                      setDetail({
                        entry,
                        title,
                        subtitle,
                        amountLabel,
                        name: nameFor(entry.address),
                        onSendTo: token === undefined || !onSendTo ? undefined : () => onSendTo(entry.address, token),
                      })
                    }
                  />
                  );
                })
              )}
            </div>
            {activityQuery.data && activityQuery.data.entries.length > 0 ? (
              <div className="pt-2.5 text-center phone:pt-1">
                <button
                  type="button"
                  onClick={() => openInExplorer(wallet.address)}
                  className="text-label font-medium text-muted hover:text-foreground hover:underline phone:min-h-11 phone:px-4"
                >
                  {t("mainScreen.viewAll")}
                </button>
              </div>
            ) : null}
            <ActivityDetailSheet
              runtime={runtime}
              detail={detail}
              onClose={() => setDetail(null)}
              onViewInExplorer={openInExplorer}
              container={sheetContainer}
            />
          </>
        )}
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Opens lunar.arweave.net's block explorer in a new tab, for the wallet ("View all") or one entry's tx id (its detail sheet). */
function openInExplorer(path: string): void {
  window.open(explorerUrlFor(path), "_blank", "noopener,noreferrer");
}

// A collectible is the thing moved, not the counterparty, so it keeps the "Sent · Beam #1" form.
function activityTitle(t: TFunction, type: "send" | "receive" | "upload", target: string, isCollectible: boolean): string {
  if (isCollectible) return t("mainScreen.activityTitle", { verb: activityVerb(t, type), target });
  if (type === "send") return t("mainScreen.activitySentTo", { target });
  if (type === "receive") return t("mainScreen.activityReceivedFrom", { target });
  return t("mainScreen.activityTitle", { verb: activityVerb(t, type), target });
}

const DATA_SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

function formatDataSize(bytes: string, locale: string): string {
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1000 && unit < DATA_SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: DATA_SIZE_UNITS[unit],
    // CLDR's short form of "byte" is "byte" for every count in English; the long form plurals it.
    unitDisplay: unit === 0 ? "long" : "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

// The upload's owner is this wallet, so its address says nothing; the content type says what went up.
function uploadTitle(t: TFunction, entry: ActivityEntry): string {
  const contentType = entry.tags.find((tag) => tag.name.toLowerCase() === "content-type")?.value.trim();
  return t("mainScreen.activityTitle", { verb: t("mainScreen.verbUploaded"), target: contentType || truncateAddress(entry.txId, 6) });
}

function activityVerb(t: TFunction, type: "send" | "receive" | "upload"): string {
  if (type === "send") return t("mainScreen.verbSent");
  if (type === "receive") return t("mainScreen.verbReceived");
  return t("mainScreen.verbUploaded");
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
