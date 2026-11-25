import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isWatchWalletMethod, type Collectible, type PortfolioHistoryRange, type PortfolioScope, type RuntimePort, type TokenBalance, type WalletSummary } from "@gleam/core";
import { LoadingBar, PullToRefreshIndicator, useFreshAfterCache, usePullToRefresh } from "@gleam/ui";
import { PortfolioChart, SendReceiveActions } from "@gleam/ui/src/components/wallet/index.ts";
import { formatCurrencyValue, formatPercent, HIDDEN_AMOUNT } from "@gleam/ui/src/format/currency.ts";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { useLocale, useT } from "../../../i18n";
import { useDisplaySettings } from "../../../display-settings";
import { useActivity } from "../../activity";
import { useCollectibles } from "../../activity";
import { CollectiblesGallery } from "../../collectibles/index.tsx";
import { useBalances } from "../../activity";
import { walletQueryKeys } from "../../activity";
import { usePortfolioHistory } from "./usePortfolioHistory";
import { PANEL_GAP_PX, useTabSwipe } from "./useTabSwipe";
import { useListDock } from "./useListDock";
import { useOtherWallets } from "../../activity";
import { useContacts } from "../../activity";
import { useOrderbookPrices, useTokenPrices } from "./useTokenPrices";
import { MainScreenNotice } from "./MainScreenNotice";
import { SiteWalletCard, type SiteWalletCardProps } from "../../site-wallet/index.tsx";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { ActivityPanel } from "./ActivityPanel";
import { HomeHeader } from "./HomeHeader";
import { readPortfolioRange, readPortfolioScope, writePortfolioRange, writePortfolioScope } from "./portfolioPrefs";
import { buildDefaultTokenRows, orderbookHoldingsValue, pricedTokenIds, restoredCache, unavailableBalanceLabel, waiting } from "./tokenRows";
import { TokensPanel } from "./TokensPanel";
import { useTokenRowControls } from "./useTokenRowControls";

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
 * never a stale combination. A failed read, or an empty `series` (both
 * price sources unavailable), keeps the last series on screen, or the
 * shimmer when there is none. Only a pull to refresh shows `LoadingBar`.
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
const TABS = ["tokens", "collectibles", "activity"] as const;

export type MainScreenTab = (typeof TABS)[number];

/** A section tab: a chip in light, an underlined label in dark so it can't be mistaken for the chart's range chips. */
function tabClassName(active: boolean): string {
  return `rounded-md px-2.5 py-1 text-label phone:hit-target layered:rounded-none layered:px-0 layered:pb-2 layered:font-semibold ${
    active
      ? "bg-mist text-foreground layered:bg-transparent layered:shadow-[inset_0_-2px_0_var(--color-foreground)]"
      : "text-muted hover:text-foreground layered:text-faint"
  }`;
}

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
  const [hiddenExpanded, setHiddenExpanded] = useState(initialTokenEditing);
  const {
    headerCollapsed,
    listDocked,
    summaryLingers,
    listSectionRef,
    headerRef,
    listDockOffsetRef,
    scrollListToDockedTop,
    returnHome,
  } = useListDock(() => {
    setActiveTab("tokens");
    setHiddenExpanded(false);
    onTabChange?.("tokens");
  });
  const controls = useTokenRowControls(runtime, wallet.address);
  const { confirmingIgnore, setConfirmingIgnore } = controls;
  const queryClient = useQueryClient();
  const panelTrackRef = useRef<HTMLDivElement>(null);
  const balancesQuery = useBalances(runtime, wallet.address);
  const activityQuery = useActivity(runtime, wallet.address);
  // A collectible received since the list was fetched: refetch it, once per activity read.
  const collectiblesRefetchedFor = useRef(0);
  useEffect(() => {
    const listed = collectiblesQuery.data;
    if (!listed || collectiblesRefetchedFor.current === activityQuery.dataUpdatedAt) return;
    const ids = new Set(listed.map((collectible) => collectible.id));
    const missing = activityQuery.data?.entries.some(
      (entry) => entry.type === "receive" && entry.collectible && !ids.has(entry.collectible.id),
    );
    if (!missing) return;
    collectiblesRefetchedFor.current = activityQuery.dataUpdatedAt;
    void queryClient.invalidateQueries({ queryKey: walletQueryKeys.collectibles(wallet.address) });
  }, [activityQuery.data, activityQuery.dataUpdatedAt, collectiblesQuery.data, queryClient, wallet.address]);
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
  const loading = waiting(balancesQuery) || waiting(activityQuery);
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
  const collectiblesFresh = useFreshAfterCache(collectiblesCached);
  const activityFresh = useFreshAfterCache(activityCached);
  // The total waits for every input, so it ticks once instead of once per query.
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


  const showTab = (tab: MainScreenTab) => {
    setActiveTab(tab);
    if (tab === "collectibles") setCollectiblesOpened(true);
    onTabChange?.(tab);
  };

  const selectTab = (tab: MainScreenTab) => {
    showTab(tab);
    scrollListToDockedTop();
  };

  const peek = useTabSwipe({
    target: rootRef,
    track: panelTrackRef,
    scroller: listSectionRef,
    active: TABS.indexOf(activeTab),
    count: TABS.length,
    docked: listDocked,
    onPeek: (index) => {
      if (TABS[index] === "collectibles") setCollectiblesOpened(true);
    },
    onSelect: (index) => showTab(TABS[index]!),
    onOpen: scrollListToDockedTop,
  });
  const peekTab = peek ? TABS[peek.index] : undefined;

  const toggleHiddenExpanded = () => {
    setHiddenExpanded((prev) => !prev);
    scrollListToDockedTop();
  };

  // Mount only: put the list where toggling edit mode leaves it. A restored
  // tab means a detail screen was opened from the docked list, so it comes
  // back docked rather than replaying the slide.
  useEffect(() => {
    if (initialTab !== "tokens") scrollListToDockedTop(true);
    else if (initialTokenEditing) scrollListToDockedTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useBackHandler(
    confirmingIgnore.size > 0 ? () => setConfirmingIgnore(new Set()) : headerCollapsed ? returnHome : null,
  );

  const summary =
    (headerCollapsed || summaryLingers) && history && portfolioHasSeries
      ? {
          value: masked ? HIDDEN_AMOUNT : formatCurrencyValue(history.currentValue + extraValue, currency ?? "USD", locale),
          percent: formatPercent(chartChange, locale),
          change: chartChange,
          range: selectedRange,
        }
      : null;

  return (
    <div ref={rootRef} className="flex min-h-full flex-col overflow-x-clip">
      <LoadingBar active={pullState.refreshing} />

      <HomeHeader
        wallet={wallet}
        headerRef={headerRef}
        collapsed={headerCollapsed}
        summary={summary}
        returnHome={returnHome}
        onOpenWalletSwitcher={onOpenWalletSwitcher}
        onOpenSettings={onOpenSettings}
        onOpenBrowser={onOpenBrowser}
      />

      {/* Once released, the pull hands over to the top bar instead of holding a second spinner. */}
      <PullToRefreshIndicator {...pullState} pull={pullState.refreshing ? 0 : pullState.pull} refreshing={false} />

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
              chartClassName="layered:h-20"
              // A failed or empty read with no series to keep holds the shimmer while it retries, never a fabricated $0.
              loading={!portfolioHasSeries}
              cached={chartCached}
              walletKey={wallet.id}
            />
          </div>

          <div className="px-6 pb-6 pt-3 phone:px-5 phone:pb-4 phone:pt-2">
            {/* With no chart above it, a full-width beam reads as an underline on the balance. */}
            <Beam className={headerStyle === "minimal" ? "w-[72px]" : undefined} />
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
        than the popup would be cut off. Undocked, it is exactly the docked
        height, so the page scrolls the section precisely up to its docked
        position and no further, however short or long the list.
      */}
      {listDocked ? <div style={{ height: listSectionRef.current?.offsetHeight }} /> : null}
      <div
        ref={listSectionRef}
        className={`px-6 pb-6 phone:px-5 phone:pb-4 phone:[@media(max-height:700px)]:pb-2 ${
          listDocked
            ? "gleam-dock-in fixed inset-x-0 bottom-0 top-[calc(4rem+var(--inset-top))] z-20 mx-auto max-w-[var(--content-max)] overflow-y-auto bg-background"
            : // Exactly the docked height, with its overflow clipped: the page then ends where the list docks, so a
              // fling of any speed stops it right there instead of carrying it past and snapping it back.
              "h-[calc(100dvh-4rem-var(--inset-top)-var(--safe-bottom))] overflow-y-clip"
        } layered:rounded-t-[20px] layered:bg-surface layered:pt-2 gleam-frost-sheet`}
        style={listDocked ? ({ "--dock-offset": `${listDockOffsetRef.current}px` } as CSSProperties) : undefined}
      >
        <div
          role="tablist"
          data-drawer-handle
          aria-label={t("mainScreen.tabsLabel")}
          className="gleam-frost-bar sticky top-0 z-10 flex items-center gap-1 bg-background pb-2.5 pt-1 phone:-mx-2.5 phone:pb-1 phone:pt-1 layered:gap-5 layered:bg-surface layered:px-3.5 phone:layered:mx-0 phone:layered:px-0"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tokens"}
            onClick={() => selectTab("tokens")}
            className={tabClassName(activeTab === "tokens")}
          >
            {t("mainScreen.tabTokens")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "collectibles"}
            onClick={() => selectTab("collectibles")}
            className={tabClassName(activeTab === "collectibles")}
          >
            {t("mainScreen.tabCollectibles")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            onClick={() => selectTab("activity")}
            className={tabClassName(activeTab === "activity")}
          >
            {t("mainScreen.tabActivity")}
          </button>
        </div>

        {/* Clips the panel waiting beside the active one, at the sheet's own edges so rows can still bleed into the gutter. */}
        <div className="phone:-mx-5 phone:overflow-x-clip phone:px-5">
          <div ref={panelTrackRef} className="relative">
            {TABS.filter((tab) => tab === activeTab || tab === peekTab).map((tab) => (
              <div
                key={tab}
                inert={tab !== activeTab}
                className={tab === activeTab ? undefined : "absolute inset-x-0"}
                style={
                  tab === activeTab || !peek
                    ? undefined
                    : { top: peek.top, transform: `translateX(calc(${Math.sign(TABS.indexOf(tab) - TABS.indexOf(activeTab))} * (100% + ${PANEL_GAP_PX}px)))` }
                }
              >
              {tab === "tokens" ? (
                <TokensPanel
                  runtime={runtime}
                  wallet={wallet}
                  showSkeleton={loading && !hasLoadedOnce}
                  balances={balancesQuery.data}
                  balancesWaiting={waiting(balancesQuery)}
                  defaultTokenRows={defaultTokenRows}
                  tokenPrices={tokenPrices}
                  currency={currency}
                  masked={masked}
                  simpleRows={simpleRows}
                  tokenLogos={tokenLogos}
                  watchOnly={watchOnly}
                  tokensCached={tokensCached}
                  controls={controls}
                  hiddenExpanded={hiddenExpanded}
                  setHiddenExpanded={setHiddenExpanded}
                  toggleHiddenExpanded={toggleHiddenExpanded}
                  listDocked={listDocked}
                  onSend={onSend}
                  onSendToken={onSendToken}
                  onOpenPoints={onOpenPoints}
                  onAddToken={onAddToken}
                />
              ) : tab === "collectibles" ? (
                <div
                  className={`min-h-60 pt-3.5 phone:min-h-0 phone:pt-1 ${collectiblesFresh ? "gleam-fresh" : ""}`}
                >
                  <CollectiblesGallery items={collectiblesQuery.data} loading={waiting(collectiblesQuery)} onOpen={onOpenCollectible} />
                </div>
              ) : (
                <ActivityPanel
                  runtime={runtime}
                  wallet={wallet}
                  showSkeleton={loading && !hasLoadedOnce}
                  fresh={activityFresh}
                  activity={activityQuery.data}
                  tokenBalances={balancesQuery.data?.tokenBalances}
                  nameFor={nameFor}
                  sheetContainer={sheetContainer}
                  onSendTo={onSendTo}
                />
              )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
