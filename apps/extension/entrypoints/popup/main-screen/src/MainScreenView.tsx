import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioHistoryRange, RuntimePort, TokenBalance, TokenPrice, WalletSummary } from "@gleam/core";
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
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { StatusDot } from "@gleam/ui/src/primitives/status-dot.tsx";
import { formatAtomicAsDisplay, formatUsd, formatWinstonAsAr, truncateAddress } from "./formatWinston";
import { generateAccountAvatarSvg } from "./generateAccountAvatar";
import { useActivity } from "../../activity/src/useActivity";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { usePortfolioHistory } from "./usePortfolioHistory";
import { useTokenPrices } from "./useTokenPrices";

/**
 * Main screen (wallet-main-screen.html) — porting what's gettable via
 * `ProtocolMap` reads: AR balance, AO token balances (empty until a
 * "watch a token" flow exists — see `handlers/reads.ts`'s doc comment),
 * the merged activity feed, the account pill's identity avatar, and the
 * total-portfolio-value chart with range tabs.
 *
 * Avatar: `AccountAvatar` (`packages/ui/src/components/wallet/
 * AccountAvatar.tsx`) renders SVG markup generated in-process by
 * `./generateAccountAvatar.ts` (`@dicebear/core` + `@dicebear/styles`,
 * `weave` style, seeded from `wallet.address`) — no network call, per
 * this task's confirmed deviation from the reference (matching
 * `UnlockScreen.tsx`'s no-per-wallet-identity-on-unlock rule and
 * `TokenGlyph.tsx`'s existing local-only identicon precedent on this same
 * screen). Generation is synchronous, so it's computed inline (via
 * `useMemo`, keyed on the address) rather than through the same
 * async-load state as the balance/activity fetches below.
 *
 * Chart: `PortfolioChart` (same directory) is fed by `usePortfolioHistory`
 * (`./usePortfolioHistory.ts`), a `useQuery` wrapping the same
 * `getPortfolioHistory` call (`ProtocolMap`, wired to `ReadsHandler`) via
 * `@gleam/core`'s `PortfolioHistoryRange` export — the shared-cache
 * pattern this screen's balances/activity already use
 * (WALLET-STATE-TANSTACK). Switching a range tab reads/fetches that
 * range's own cache entry and updates the chart, %-change badge, and
 * period label together from one query response, never a stale
 * combination. An empty `series` (both price sources unavailable) falls
 * back to `NetworkErrorBanner`, matching the balance/activity failure
 * path, rather than a broken/blank chart.
 *
 * The `Beam` identity divider (`packages/ui/src/primitives/beam.tsx`,
 * wallet-main-screen.html's `.beam-divider`) sits between the chart's
 * range-tabs and the Send/Receive actions row, matching the reference's
 * placement now that the chart exists.
 *
 * Tokens/Activity: a single tab control (local `activeTab` state, no
 * routing) replaces the old stacked "Tokens" and "Activity" sections that
 * each had their own "View all" button into a full-list screen — see
 * `main-screen-tabs`'s intent. The tab-button visual/interaction pattern
 * (`role="tablist"`/`"tab"`, `aria-selected`, `bg-foreground text-background`
 * for the active tab) is copied from `PortfolioChart`'s existing range
 * tabs above, on this same screen, rather than inventing a second tab
 * visual language. The Tokens tab renders the full, untruncated
 * `state.tokenBalances` list; the Activity tab caps at the 10 most recent
 * entries and its "View all" action, along with each row's click, opens
 * lunar.arweave.net's block explorer in a new tab rather than an in-app
 * full-list screen — there is no in-app activity list/detail screen left
 * to navigate to.
 *
 * Navigation entry points: the account pill's chevron
 * (wallet-main-screen.html's `.account-pill`) opens the wallet switcher
 * via `onOpenWalletSwitcher`; the header's gear icon
 * (`.icon-btn[aria-label="Settings"]`) opens the dedicated settings-home
 * screen via `onOpenSettings`, which owns navigation to every settings
 * category (lock/auto-lock, connected apps, network & peers, dark mode,
 * and so on) — this component no longer renders an inline settings menu
 * or reads/writes theme preference itself.
 */
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
}

/**
 * A default (AR/AO) row carries enough to render a `TokenRow` and, for AO,
 * to be clicked into the send flow the same as any other `TokenBalance` —
 * `sendToken` is `null` for AR, since the top-level "Send" action (not a
 * per-row click) is AR's entry point today, matching `TokenRow`'s existing
 * `onClick` no-op precedent elsewhere on this screen.
 */
interface DefaultTokenRow {
  key: string;
  ticker: string;
  name: string;
  amount: string;
  usdValue: string | undefined;
  sendToken: TokenBalance | null;
}

/**
 * Looks up a token's price (by AO `processId`, or `null` for AR) from
 * `useTokenPrices()`'s cache and formats `amount * price` as a USD string —
 * `undefined` when the price isn't loaded yet or couldn't be computed
 * (`TokenPrice.usd === null`, per that query's own HONESTY contract), so
 * `TokenRow` renders no `$` line rather than a fabricated `$0.00`.
 */
function usdValueFor(prices: TokenPrice[] | undefined, processId: string | null, amount: number): string | undefined {
  const price = prices?.find((entry) => entry.processId === processId)?.usd;
  return typeof price === "number" ? formatUsd(amount * price) : undefined;
}

/**
 * Builds the AR/AO default rows always shown at the top of the Tokens tab
 * (RELEVANT RULES: "AR and AO are treated as two default tokens that
 * always appear"). Reads straight off `useBalances()`'s cache: `undefined`
 * `data` (not yet loaded) or no matching `TokenBalance` entry both fall
 * back to `DEFAULT_TOKENS`' own `"0"` constant, never `null`/`undefined`.
 */
function buildDefaultTokenRows(data: WalletBalances | undefined, prices: TokenPrice[] | undefined): DefaultTokenRow[] {
  const aoBalance = data?.tokenBalances.find((token) => token.processId === DEFAULT_AO_TOKEN.processId);
  const arAmount = data?.arBalance !== undefined ? Number(formatWinstonAsAr(data.arBalance, 12)) : 0;
  const aoAmount = aoBalance ? Number(formatAtomicAsDisplay(aoBalance.quantity, aoBalance.denomination, aoBalance.denomination)) : 0;

  return [
    {
      key: "default-ar",
      ticker: DEFAULT_AR_TOKEN.ticker,
      name: DEFAULT_AR_TOKEN.name,
      amount: data?.arBalance !== undefined ? formatWinstonAsAr(data.arBalance) : DEFAULT_AR_TOKEN.defaultDisplayAmount,
      usdValue: data?.arBalance !== undefined ? usdValueFor(prices, null, arAmount) : undefined,
      sendToken: null,
    },
    {
      key: "default-ao",
      ticker: DEFAULT_AO_TOKEN.ticker,
      name: DEFAULT_AO_TOKEN.name,
      amount: aoBalance ? formatAtomicAsDisplay(aoBalance.quantity, aoBalance.denomination) : DEFAULT_AO_TOKEN.defaultDisplayAmount,
      usdValue: aoBalance ? usdValueFor(prices, DEFAULT_AO_TOKEN.processId, aoAmount) : undefined,
      sendToken: aoBalance ?? null,
    },
  ];
}

/**
 * The non-default watched tokens rendered below the AR/AO rows — every
 * `TokenBalance` whose `processId` isn't the AO default, unchanged from
 * this screen's pre-existing rendering (RELEVANT RULES: "additional
 * watched AO tokens continue to render below these two defaults"). These
 * have no entry in `DEFAULT_TOKEN_REGISTRY`, so `usdValueFor` always
 * resolves `undefined` for them today — no `$` line until such a token
 * gets a confirmed price-source mapping.
 */
function nonDefaultTokenBalances(data: WalletBalances | undefined): TokenBalance[] {
  return (data?.tokenBalances ?? []).filter((token) => token.processId !== DEFAULT_AO_TOKEN.processId);
}

/**
 * How long a range-tab click waits, quiet, before the chart actually
 * fetches that range — a debounce, not a cooldown: each click resets the
 * timer rather than being dropped, so a rapid 7D→1M→ALL→7D tour never
 * fires more than one `getPortfolioHistory` call (for whichever range the
 * user was still on once they stopped clicking) instead of one per tab.
 * This is what keeps a quick tab tour from tripping CoinGecko's free-tier
 * rate limit the way clicking through all 5 tabs previously could (see
 * `usePortfolioHistory`'s `staleTime` comment for the caching half of that
 * fix — this is the request-shaping half).
 */
const PORTFOLIO_RANGE_DEBOUNCE_MS = 400;

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
}: MainScreenViewProps) {
  const [activeTab, setActiveTab] = useState<"tokens" | "activity">("tokens");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [listDocked, setListDocked] = useState(false);
  const collapseRafRef = useRef<number | null>(null);
  const listSectionRef = useRef<HTMLDivElement>(null);
  const listDockOffsetRef = useRef(0);
  const balancesQuery = useBalances(runtime, wallet.address);
  const activityQuery = useActivity(runtime, wallet.address);
  const tokenPricesQuery = useTokenPrices(runtime);
  const hasLoadedOnce = balancesQuery.isSuccess || activityQuery.isSuccess;
  const loading = balancesQuery.isLoading || activityQuery.isLoading;
  const loadError = balancesQuery.error ?? activityQuery.error ?? null;
  /**
   * `selectedRange` drives the tab highlight and updates the instant a
   * tab is clicked, so the UI never feels unresponsive to the click
   * itself. `debouncedRange` drives the actual query and lags behind by
   * `PORTFOLIO_RANGE_DEBOUNCE_MS` of quiet — every click restarts the
   * timer, so a fast tour through several tabs shows the chart's loading
   * state (via `debouncedRange !== selectedRange`, below) the whole time
   * but only fetches once, for the range the user actually settled on.
   */
  const [selectedRange, setSelectedRange] = useState<PortfolioHistoryRange>("7D");
  const [debouncedRange, setDebouncedRange] = useState<PortfolioHistoryRange>("7D");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRange(selectedRange), PORTFOLIO_RANGE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [selectedRange]);
  const portfolioHistoryQuery = usePortfolioHistory(runtime, wallet.address, debouncedRange);

  const avatarSvg = useMemo(() => generateAccountAvatarSvg(wallet.address), [wallet.address]);

  /**
   * Chrome renders the popup as one continuously-growing box past its
   * 600px ceiling (see theme.css's `[data-layout="popup"]` comment) —
   * there's no inner scroll container, so `window.scrollY` is the only
   * scroll position that exists here. Fades the header (status dot, chart,
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

      <div className="sticky top-0 z-30 flex items-center justify-between gap-2.5 bg-background px-5 pb-2.5 pt-4">
        <button
          type="button"
          onClick={onOpenWalletSwitcher}
          aria-haspopup="dialog"
          aria-label={`${wallet.name}, address ${wallet.address}, view account details`}
          className="-ml-3 flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-0 pr-2 hover:bg-mist"
        >
          <AccountAvatar svgMarkup={avatarSvg} label={`${wallet.name} avatar`} size={24} />
          <span className="truncate text-label">{wallet.name}</span>
          <span className="truncate font-mono text-label text-faint">
            {truncateAddress(wallet.address)}
          </span>
          <span aria-hidden="true" className="flex-shrink-0 text-faint">
            <ChevronIcon />
          </span>
        </button>

        <button
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground"
        >
          <SettingsIcon />
        </button>
      </div>

      {/*
        Fades the status dot + chart block toward invisible on scroll. Its
        space stays reserved in the layout at all times — only opacity
        transitions — and the chart's own fetch/range state stays alive
        underneath, so re-expanding never re-fetches or resets the range
        tab.
      */}
      <div className="transition-opacity duration-300 ease-out" style={{ opacity: headerCollapsed ? 0 : 1 }}>
        <div inert={headerCollapsed}>
          <div className="px-5 pb-1">
            <StatusDot label="arweave.net" />
          </div>

          <div className="px-6 pb-1 pt-2.5">
            <PortfolioChart
              points={portfolioHistoryQuery.data?.series ?? []}
              currentUsdValue={portfolioHistoryQuery.data?.currentUsdValue ?? 0}
              usdChange={portfolioHistoryQuery.data?.usdChange ?? 0}
              periodLabel={portfolioHistoryQuery.data?.periodLabel ?? ""}
              activeRange={selectedRange}
              onRangeChange={setSelectedRange}
              /**
               * True for the whole debounce window too (not just while
               * the query itself is in flight) — `selectedRange` moves
               * the instant a tab is clicked, but `debouncedRange` (and
               * so `portfolioHistoryQuery`) hasn't caught up yet, and
               * `portfolioHistoryQuery` is still holding the *previous*
               * range's data/error during that window. Showing loading
               * here avoids flashing the old range's chart, %-change, or
               * (see `onRetry` below) its stale error state under a tab
               * that no longer matches it. `isFetching` rather than
               * `isLoading`: `isLoading` is only true for a range's very
               * first fetch (no cached data yet) — clicking the error
               * banner's Retry re-runs an already-errored query, which
               * `isLoading` never reflects, so it was leaving the banner
               * on screen through the whole retry with no visible change.
               */
              loading={debouncedRange !== selectedRange || portfolioHistoryQuery.isFetching}
              /**
               * `series: []` on a *resolved* response (no thrown query
               * error) is `getPortfolioHistory`'s own signal that both AR
               * price sources failed (`reads.ts`'s doc comment) — a real
               * zero-balance wallet still gets a non-empty series (AR/USD
               * prices exist independent of the user's balance, just
               * every point's `usdValue` is 0), so an empty series here
               * only ever means the fetch effectively failed. Passed
               * through as `onRetry` rather than swapping `PortfolioChart`
               * out for `NetworkErrorBanner` at this level, so the range
               * tabs (rendered inside `PortfolioChart`) stay visible and
               * clickable even while the active range is failed — a
               * failed "ALL" no longer strands the user without a way
               * back to a previously-cached "7D". Gated on
               * `debouncedRange === selectedRange` for the same
               * stale-data reason as `loading` above: never surface the
               * error banner for a range the user has already clicked
               * away from. Also gated on `!isFetching` so clicking Retry
               * hides the banner immediately (`loading` above turns
               * true from the same `isFetching` flip) instead of leaving
               * it on screen, inert, for the duration of the refetch.
               */
              onRetry={
                debouncedRange === selectedRange &&
                !portfolioHistoryQuery.isFetching &&
                (portfolioHistoryQuery.error || (portfolioHistoryQuery.isSuccess && portfolioHistoryQuery.data.series.length === 0))
                  ? () => void portfolioHistoryQuery.refetch()
                  : undefined
              }
            />
          </div>

          <div className="px-6 pb-5 pt-3">
            <Beam />
          </div>

          <div className="px-6 pb-6">
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
        already was and animate down to 0 instead of snapping.
      */}
      {listDocked ? <div style={{ height: listSectionRef.current?.offsetHeight }} /> : null}
      <div
        ref={listSectionRef}
        className={`px-6 pb-6 ${listDocked ? "gleam-dock-in fixed inset-x-0 top-16 z-20" : ""}`}
        style={listDocked ? ({ "--dock-offset": `${listDockOffsetRef.current}px` } as CSSProperties) : undefined}
      >
        <div
          role="tablist"
          aria-label="Tokens and activity"
          className="sticky top-0 z-10 flex items-center gap-1 bg-background pb-2.5 pt-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tokens"}
            onClick={() => setActiveTab("tokens")}
            className={`rounded-md px-2.5 py-1 text-label ${
              activeTab === "tokens" ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            Tokens
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "activity"}
            onClick={() => setActiveTab("activity")}
            className={`rounded-md px-2.5 py-1 text-label ${
              activeTab === "activity" ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            Activity
          </button>
        </div>

        {activeTab === "tokens" ? (
          <div className="min-h-60 border-t border-line">
            {loading && !hasLoadedOnce ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              <>
                {buildDefaultTokenRows(balancesQuery.data, tokenPricesQuery.data).map((row) => (
                  <TokenRow
                    key={row.key}
                    glyph={{ label: row.ticker.slice(0, 2).toUpperCase(), tone: 2 }}
                    name={row.name}
                    amount={row.amount}
                    usdValue={row.usdValue}
                    loading={loading}
                    onClick={row.sendToken ? () => onSendToken(row.sendToken as TokenBalance) : undefined}
                  />
                ))}
                {nonDefaultTokenBalances(balancesQuery.data).map((token) => (
                  <TokenRow
                    key={token.processId}
                    glyph={{ label: token.ticker.slice(0, 2).toUpperCase(), tone: 2 }}
                    name={token.ticker}
                    amount={formatAtomicAsDisplay(token.quantity, token.denomination)}
                    loading={loading}
                    onClick={() => onSendToken(token)}
                  />
                ))}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="min-h-60 border-t border-line">
              {loading && !hasLoadedOnce ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : !activityQuery.data || activityQuery.data.entries.length === 0 ? (
                <EmptyState message="No activity yet. Once you send, receive, or upload, it'll show up here." />
              ) : (
                activityQuery.data.entries.slice(0, 10).map((entry) => (
                  <ActivityRow
                    key={entry.txId}
                    activityType={entry.type}
                    title={`${activityVerb(entry.type)} · ${truncateAddress(entry.address)}`}
                    subtitle={
                      entry.status === "pending"
                        ? "Pending confirmation"
                        : entry.status === "failed"
                          ? entry.error
                            ? `Failed · ${entry.error}`
                            : "Failed"
                          : relativeTime(entry.timestamp)
                    }
                    amountLabel={entry.amount ? `${entry.type === "receive" ? "+" : "-"}${formatWinstonAsAr(entry.amount)} AR` : "—"}
                    amountTone={entry.type === "receive" ? "positive" : "neutral"}
                    pending={entry.status === "pending"}
                    onClick={() => openInExplorer(entry.txId)}
                  />
                ))
              )}
            </div>
            <div className="pt-2.5 text-center">
              <button
                type="button"
                onClick={() => openInExplorer(wallet.address)}
                className="text-label font-medium text-muted hover:text-foreground hover:underline"
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

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
  window.open(`https://lunar.arweave.net/#/explorer/${path}`, "_blank", "noopener,noreferrer");
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
