import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { explorerUrlFor, type Collectible, type CollectibleRef, type DisplayCurrency, type PortfolioHistoryRange, type PortfolioScope, type RuntimePort, type TokenBalance, type TokenPrice, type WalletSummary } from "@gleam/core";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
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
import { formatCurrencyValue, HIDDEN_AMOUNT } from "@gleam/ui/src/format/currency.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { displayTicker, formatAtomicAsDisplay, formatWinstonAsAr } from "./formatWinston";
import { useAddressIdentity } from "../../../address-identity";
import { useDisplaySettings } from "../../../display-settings";
import { useActivity } from "../../activity/src/useActivity";
import { useCollectibles } from "../../activity/src/useCollectibles";
import { CollectiblesGrid } from "../../collectibles/index.tsx";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { walletQueryKeys } from "../../activity/src/queryKeys";
import { usePortfolioHistory } from "./usePortfolioHistory";
import { useOtherWallets } from "../../activity/src/useOtherWallets";
import { useTokenPrices } from "./useTokenPrices";
import { MainScreenNotice } from "./MainScreenNotice";
import { SiteWalletCard, type SiteWalletCardProps } from "../../site-wallet/index.tsx";
import { PointsTokenRow } from "../../points/index.tsx";
import { useCopy } from "../../points/src/useCopy";
import { readRowVisibility, shownTokenLogo, writeRowVisibility, type RowVisibility } from "../../../token-visibility";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";

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
 * the chart and its range tabs can be turned off, and tapping the large
 * figure hides every balance on this screen until it's tapped again.
 *
 * Tokens/Activity: a single tab control (local `activeTab` state, no
 * routing) switches between the two sections. The tab-button
 * visual/interaction pattern (`role="tablist"`/`"tab"`, `aria-selected`,
 * `bg-foreground text-background` for the active tab) is copied from
 * `PortfolioChart`'s existing range tabs above, on this same screen. The
 * Tokens tab renders the full, untruncated `state.tokenBalances` list;
 * the Activity tab caps at the 10 most recent entries and its "View all"
 * action, along with each row's click, opens lunar.arweave.net's block
 * explorer in a new tab rather than an in-app full-list screen — there is
 * no in-app activity list/detail screen to navigate to.
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
  onReceive: () => void;
  onOpenWalletSwitcher: () => void;
  onOpenSettings: () => void;
  onOpenPoints: () => void;
  /** Opens the dApp browser. Omitted where the host has none, which hides its button. */
  onOpenBrowser?: () => void;
  /** Opens the permissions screen for a site that was using another wallet. */
  onUseGleamOnSite: SiteWalletCardProps["onUseGleam"];
  onOpenCollectible: (collectible: Collectible) => void;
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
  value: string | undefined;
  send: "ar" | TokenBalance | null;
}

/**
 * Shown in place of a formatted amount for a `TokenBalance` whose
 * `available` is `false` (`handlers/reads.ts`: a failed HyperBEAM read, or
 * a non-AO token whose denomination couldn't be confirmed) — never a
 * guessed quantity, which for a wrong denomination could be off by orders
 * of magnitude.
 */
const UNAVAILABLE_BALANCE_LABEL = "Unavailable";

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
): string | undefined {
  const price = prices?.find((entry) => entry.processId === processId)?.price;
  return typeof price === "number" && currency ? formatCurrencyValue(amount * price, currency) : undefined;
}

/**
 * Builds the AR/AO default rows always shown at the top of the Tokens tab.
 * Reads straight off `useBalances()`'s cache: `undefined`
 * `data` (not yet loaded) or no matching `TokenBalance` entry both fall
 * back to `DEFAULT_TOKENS`' own `"0"` constant, never `null`/`undefined`.
 */
function buildDefaultTokenRows(
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
      amount: data?.arBalance !== undefined ? formatWinstonAsAr(data.arBalance) : DEFAULT_AR_TOKEN.defaultDisplayAmount,
      value: data?.arBalance !== undefined ? valueFor(prices, currency, null, arAmount) : undefined,
      send: "ar",
    },
    {
      key: "default-ao",
      ticker: DEFAULT_AO_TOKEN.ticker,
      name: DEFAULT_AO_TOKEN.name,
      logoUrl: DEFAULT_AO_TOKEN.logoUrl,
      amount: aoAvailable
        ? formatAtomicAsDisplay(aoBalance.quantity, aoBalance.denomination)
        : aoBalance
          ? UNAVAILABLE_BALANCE_LABEL
          : DEFAULT_AO_TOKEN.defaultDisplayAmount,
      value: aoAvailable ? valueFor(prices, currency, DEFAULT_AO_TOKEN.processId, aoAmount) : undefined,
      send: aoAvailable ? (aoBalance ?? null) : null,
    },
  ];
}

/**
 * The non-default watched tokens rendered below the AR/AO rows — every
 * `TokenBalance` whose `processId` isn't the AO default. These have no
 * entry in `DEFAULT_TOKEN_REGISTRY`, so `valueFor` always
 * resolves `undefined` for them today — no value line until such a token
 * gets a confirmed price-source mapping.
 */
function nonDefaultTokenBalances(data: WalletBalances | undefined): TokenBalance[] {
  return (data?.tokenBalances ?? []).filter((token) => token.processId !== DEFAULT_AO_TOKEN.processId);
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
  if (!entry.token) return `${formatWinstonAsAr(entry.amount)} AR`;

  const match = tokenBalances?.find((token) => token.processId === entry.token);
  if (match && match.available !== false) {
    return `${formatAtomicAsDisplay(entry.amount, match.denomination)} ${displayTicker(match.ticker)}`;
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
function collectibleLabel(collectible: CollectibleRef): string {
  return collectible.name ?? "Collectible";
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
  onReceive,
  onOpenWalletSwitcher,
  onOpenSettings,
  onOpenPoints,
  onOpenBrowser,
  onUseGleamOnSite,
  onOpenCollectible,
  initialTab = "tokens",
  onTabChange,
}: MainScreenViewProps) {
  const [activeTab, setActiveTab] = useState<MainScreenTab>(initialTab);
  // Discovery is slow, so it starts on first open rather than with the main screen.
  const [collectiblesOpened, setCollectiblesOpened] = useState(initialTab === "collectibles");
  const collectiblesQuery = useCollectibles(runtime, wallet.address, { enabled: collectiblesOpened });
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [listDocked, setListDocked] = useState(false);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
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
  const showChart = displaySettings?.showChart ?? true;
  const showTokenLogos = displaySettings?.showTokenLogos ?? false;
  const masked = displaySettings?.balancesHidden ?? false;
  const toggleMasked = () => void updateDisplaySettings({ balancesHidden: !masked });
  const tokenPricesQuery = useTokenPrices(runtime, currency);
  const hasLoadedOnce = balancesQuery.isSuccess || activityQuery.isSuccess;
  const loading = balancesQuery.isLoading || activityQuery.isLoading;
  const loadError = balancesQuery.error ?? activityQuery.error ?? null;
  const [selectedRange, setSelectedRange] = useState<PortfolioHistoryRange>("7D");
  const otherWalletsQuery = useOtherWallets(runtime, wallet.id);
  const hasOtherWallets = (otherWalletsQuery.data?.length ?? 0) > 0;
  const [preferredScope, setPreferredScope] = useState<PortfolioScope>(readPortfolioScope);
  // With a single wallet "all" equals "wallet"; resolving it here keeps one cache entry and no toggle.
  // The toggle lives on the chart, so without it the figure stays on this wallet.
  const portfolioScope: PortfolioScope = hasOtherWallets && showChart ? preferredScope : "wallet";
  const togglePortfolioScope = () => {
    const next: PortfolioScope = portfolioScope === "all" ? "wallet" : "all";
    setPreferredScope(next);
    writePortfolioScope(next);
  };
  // Waits for the wallet list so a saved "all" preference doesn't first fetch the single-wallet view.
  const portfolioHistoryQuery = usePortfolioHistory(runtime, wallet.address, selectedRange, portfolioScope, currency, {
    enabled: !otherWalletsQuery.isPending,
  });

  const defaultTokenRows = buildDefaultTokenRows(balancesQuery.data, tokenPricesQuery.data, currency);
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
    <div className="flex min-h-full flex-col">
      {loadError ? (
        <NetworkErrorBanner
          onRetry={() => {
            void balancesQuery.refetch();
            void activityQuery.refetch();
          }}
        />
      ) : null}

      <div className="sticky top-[var(--inset-top)] z-30 flex items-center justify-between gap-2.5 bg-background px-5 pb-2.5 pt-4 phone:h-16 phone:py-0">
        {headerCollapsed ? (
          // h-9 matches the account pill's height so the row, and the list docked under it, don't shift.
          <button
            type="button"
            aria-label="Back"
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
              aria-label={`${wallet.name}, address ${wallet.address}, view account details`}
              className="flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-0 pr-1 phone:min-h-11 phone:gap-2.5"
            >
              <AccountAvatar svgMarkup={avatarSvg} label={`${wallet.name} avatar`} size={24} />
              <span className="truncate text-label">{wallet.name}</span>
              <span className="truncate font-mono text-label text-faint">
                {truncateAddress(wallet.address, 6)}
              </span>
            </button>
            <button
              type="button"
              onClick={copyAddress}
              aria-label={addressCopied ? "Address copied" : "Copy address"}
              title={addressCopied ? "Copied" : "Copy address"}
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-opacity focus-visible:opacity-100 group-hover:opacity-100 phone:opacity-100 phone:hit-target ${addressCopied ? "text-positive opacity-100" : "text-muted opacity-0 hover:text-foreground"}`}
            >
              {addressCopied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        )}

        <div className="flex flex-shrink-0 items-center phone:-mr-3">
          {onOpenBrowser ? (
            <button
              type="button"
              aria-label="Browser"
              onClick={onOpenBrowser}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground phone:h-11 phone:w-11"
            >
              <GlobeIcon />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Settings"
            onClick={onOpenSettings}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground phone:h-11 phone:w-11"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

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
          <div className="px-6 pt-0.5 phone:px-5 phone:pb-1 phone:pt-1">
            <PortfolioChart
              points={portfolioHistoryQuery.data?.series ?? []}
              currentValue={portfolioHistoryQuery.data?.currentValue ?? 0}
              currency={currency ?? "USD"}
              change={portfolioHistoryQuery.data?.change ?? 0}
              periodLabel={portfolioHistoryQuery.data?.periodLabel ?? ""}
              activeRange={selectedRange}
              onRangeChange={setSelectedRange}
              scope={portfolioScope}
              onToggleScope={hasOtherWallets ? togglePortfolioScope : undefined}
              headline={
                headlineRow
                  ? headlineRow.amount === UNAVAILABLE_BALANCE_LABEL
                    ? { amount: `${headlineRow.ticker} unavailable` }
                    : { amount: headlineRow.amount, unit: headlineRow.ticker }
                  : undefined
              }
              masked={masked}
              onToggleMasked={displaySettings ? toggleMasked : undefined}
              showChart={showChart}
              loading={portfolioHistoryQuery.isPending || portfolioHistoryQuery.isFetching}
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
               * back to a previously-cached "7D". Gated on `!isFetching`
               * so clicking Retry hides the banner immediately instead
               * of leaving it on screen, inert, for the duration of the
               * refetch. `isFetching` rather than `isLoading` for
               * `loading`: a Retry re-runs an already-errored query,
               * which `isLoading` never reflects.
               */
              onRetry={
                !portfolioHistoryQuery.isFetching &&
                (portfolioHistoryQuery.error || (portfolioHistoryQuery.isSuccess && portfolioHistoryQuery.data.series.length === 0))
                  ? () => void portfolioHistoryQuery.refetch()
                  : undefined
              }
            />
          </div>

          <div className="px-6 pb-6 pt-3 phone:px-5 phone:pb-4 phone:pt-2">
            <Beam />
          </div>

          <div className="px-6 pb-5 phone:px-5 phone:pb-4">
            <SendReceiveActions onSend={onSend} onReceive={onReceive} />
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
        page tall enough for a tab click to scroll the section all the way
        up to its docked position even when the list is short.
      */}
      {listDocked ? <div style={{ height: listSectionRef.current?.offsetHeight }} /> : null}
      <div
        ref={listSectionRef}
        className={`px-6 pb-6 phone:px-5 phone:pb-4 phone:[@media(max-height:700px)]:pb-2 ${
          listDocked
            ? "gleam-dock-in fixed inset-x-0 bottom-0 top-[calc(4rem+var(--inset-top))] z-20 mx-auto max-w-[var(--content-max)] overflow-y-auto bg-background"
            : "min-h-[calc(100dvh-4rem)] phone:min-h-0"
        }`}
        style={listDocked ? ({ "--dock-offset": `${listDockOffsetRef.current}px` } as CSSProperties) : undefined}
      >
        <div
          role="tablist"
          aria-label="Tokens, collectibles and activity"
          className="sticky top-0 z-10 flex items-center gap-1 bg-background pb-2.5 pt-1 phone:-mx-2.5 phone:pb-1 phone:pt-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tokens"}
            onClick={() => selectTab("tokens")}
            className={`rounded-md px-2.5 py-1 text-label phone:hit-target ${
              activeTab === "tokens" ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            Tokens
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "collectibles"}
            onClick={() => selectTab("collectibles")}
            className={`rounded-md px-2.5 py-1 text-label phone:hit-target ${
              activeTab === "collectibles" ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            Collectibles
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            onClick={() => selectTab("activity")}
            className={`rounded-md px-2.5 py-1 text-label phone:hit-target ${
              activeTab === "activity" ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            Activity
          </button>
        </div>

        {activeTab === "tokens" ? (
          <div className="min-h-60 border-t border-line phone:min-h-0 phone:border-t-0">
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
                        glyph={{ label: row.ticker.slice(0, 2).toUpperCase(), tone: 2, logoUrl: showTokenLogos ? row.logoUrl : undefined }}
                        name={row.name}
                        amount={masked ? HIDDEN_AMOUNT : row.amount}
                        value={masked && row.value !== undefined ? HIDDEN_AMOUNT : row.value}
                        loading={loading}
                        onClick={send === null ? undefined : send === "ar" ? onSend : () => onSendToken(send)}
                        className="border-b-0"
                      />
                    ),
                  })),
                  {
                    key: "gleam-points",
                    label: "Gleam Points",
                    defaultHidden: false,
                    node: <PointsTokenRow runtime={runtime} wallet={wallet} onOpen={onOpenPoints} className="border-b-0" />,
                  },
                  ...nonDefaultTokenBalances(balancesQuery.data).map((token) => {
                    const discovered = token.source === "discovered";
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
                            logoUrl: shownTokenLogo(token, rowVisibility, showTokenLogos),
                          }}
                          name={displayTicker(token.ticker)}
                          amount={
                            token.available === false
                              ? UNAVAILABLE_BALANCE_LABEL
                              : masked
                                ? HIDDEN_AMOUNT
                                : formatAtomicAsDisplay(token.quantity, token.denomination)
                          }
                          loading={loading}
                          onClick={token.available === false ? undefined : () => onSendToken(token)}
                          className="border-b-0"
                        />
                      ),
                    };
                  }),
                ].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
                const hiddenRows = rows.filter(isRowHidden);
                const renderRow = (row: ListedTokenRow) => {
                  const hidden = isRowHidden(row);
                  const { processId } = row;
                  if (processId !== undefined && confirmingIgnore === processId) {
                    return (
                      <div key={row.key} className="flex flex-col gap-2 border-b border-line px-3.5 py-3 last:border-b-0 phone:border-b-0 phone:px-0">
                        <p className="text-caption leading-relaxed text-muted">
                          Ignore {row.label}? It won&apos;t show anywhere in Gleam. To bring it back, add
                          its process id in Manage tokens.
                        </p>
                        {ignoreFailed ? (
                          <p role="alert" className="text-caption text-warning">
                            Couldn&apos;t ignore it. Try again.
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-3 text-caption font-semibold">
                          <button
                            type="button"
                            onClick={() => setConfirmingIgnore(null)}
                            className="text-muted hover:text-foreground"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={ignoring}
                            onClick={() => void ignoreToken(processId)}
                            className="text-warning disabled:opacity-60"
                          >
                            {ignoring ? "Ignoring…" : "Ignore"}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  const actionClassName =
                    "rounded-md bg-mist px-2 py-1 text-caption font-semibold text-muted hover:text-foreground phone:flex phone:min-h-11 phone:items-center phone:px-3.5";
                  return (
                    <div key={row.key} data-editing={hiddenExpanded || undefined} className="group relative border-b border-line last:border-b-0 phone:border-b-0">
                      {row.node}
                      {hiddenExpanded ? (
                        <div className="absolute right-3.5 top-1/2 flex -translate-y-1/2 gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 phone:right-0 phone:opacity-100">
                          {hidden && processId !== undefined ? (
                            <button
                              type="button"
                              aria-label={`Ignore ${row.label}`}
                              onClick={() => {
                                setIgnoreFailed(false);
                                setConfirmingIgnore(processId);
                              }}
                              className={actionClassName}
                            >
                              Ignore
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`${hidden ? "Show" : "Hide"} ${row.label}`}
                            onClick={() => toggleRowHidden(row)}
                            className={actionClassName}
                          >
                            {hidden ? "Show" : "Hide"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                };
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
                          <span>Hidden ({hiddenRows.length})</span>
                          <ChevronIcon open={hiddenExpanded} />
                        </button>
                        {hiddenExpanded ? hiddenRows.map(renderRow) : null}
                      </>
                    ) : listDocked || hiddenExpanded ? (
                      // With nothing hidden there's no accordion to open, so this is the way into Show/Hide.
                      <button
                        type="button"
                        onClick={() => setHiddenExpanded((prev) => !prev)}
                        className="px-3.5 py-3 text-caption text-faint hover:text-foreground phone:flex phone:min-h-11 phone:items-center phone:px-0 phone:text-label"
                      >
                        {hiddenExpanded ? "Done" : "Edit list"}
                      </button>
                    ) : null}
                  </>
                );
              })()
            )}
          </div>
        ) : activeTab === "collectibles" ? (
          <div className="min-h-60 border-t border-line pt-3.5 phone:min-h-0 phone:border-t-0 phone:pt-1">
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
            <div className="min-h-60 border-t border-line phone:min-h-0 phone:border-t-0">
              {loading && !hasLoadedOnce ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : !activityQuery.data || activityQuery.data.entries.length === 0 ? (
                <EmptyState message="No activity yet. Once you send, receive, or upload, it'll show up here." />
              ) : (
                activityQuery.data.entries.slice(0, ACTIVITY_PREVIEW_LIMIT).map((entry) => (
                  <ActivityRow
                    key={entry.txId}
                    activityType={entry.type}
                    title={
                      entry.swap
                        ? `Swap order · ${swapAssetLabel(entry.swap.process, balancesQuery.data?.tokenBalances)}`
                        : `${activityVerb(entry.type)} · ${entry.collectible ? collectibleLabel(entry.collectible) : truncateAddress(entry.address, 6)}`
                    }
                    subtitle={
                      entry.swap && entry.status === "confirmed"
                        ? `Order placed${entry.timestamp > 0 ? ` · ${relativeTime(entry.timestamp)}` : ""}`
                        : entry.unverified
                        ? `Unverified transfer request${entry.timestamp > 0 ? ` · ${relativeTime(entry.timestamp)}` : ""}`
                        : entry.status === "pending"
                        ? "Pending confirmation"
                        : entry.status === "failed"
                          ? entry.error
                            ? `Failed · ${entry.error}`
                            : "Failed"
                          : relativeTime(entry.timestamp)
                    }
                    amountLabel={
                      entry.amount
                        ? `${entry.type === "receive" ? "+" : "-"}${formatActivityAmount(entry, balancesQuery.data?.tokenBalances)}`
                        : "—"
                    }
                    amountTone={entry.type === "receive" && !entry.unverified ? "positive" : "neutral"}
                    collectible={
                      entry.collectible
                        ? { name: collectibleLabel(entry.collectible), imageUrl: entry.collectible.imageUrl }
                        : undefined
                    }
                    pending={entry.status === "pending"}
                    onClick={() => openInExplorer(entry.txId)}
                  />
                ))
              )}
            </div>
            <div className="pt-2.5 text-center phone:pt-1">
              <button
                type="button"
                onClick={() => openInExplorer(wallet.address)}
                className="text-label font-medium text-muted hover:text-foreground hover:underline phone:min-h-11 phone:px-4"
              >
                View all
              </button>
            </div>
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

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
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

/**
 * Opens lunar.arweave.net's block explorer in a new tab — the in-app
 * activity list/detail screen this replaced is gone entirely (see this
 * component's doc comment), so both the Activity tab's "View all" action
 * (wallet address) and each row's click (that entry's tx id) route
 * straight to the external explorer instead.
 */
function openInExplorer(path: string): void {
  window.open(explorerUrlFor(path), "_blank", "noopener,noreferrer");
}

function activityVerb(type: "send" | "receive" | "upload"): string {
  if (type === "send") return "Sent";
  if (type === "receive") return "Received";
  return "Uploaded";
}

function relativeTime(timestampMs: number): string {
  if (timestampMs <= 0) return "Pending";
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
