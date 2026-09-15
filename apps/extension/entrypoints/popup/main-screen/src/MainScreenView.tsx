import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ActivityPage,
  PortfolioHistory,
  PortfolioHistoryRange,
  RuntimePort,
  TokenBalance,
  WalletSummary,
  Winston,
} from "@gleam/core";
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
import { formatWinstonAsAr, truncateAddress } from "./formatWinston";
import { generateAccountAvatarSvg } from "./generateAccountAvatar";

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
 * Chart: `PortfolioChart` (same directory) is fed by
 * `getPortfolioHistory` (`ProtocolMap`, wired to `ReadsHandler` in this
 * same task) via `@gleam/core`'s `PortfolioHistory`/`PortfolioHistoryRange`
 * barrel exports. Switching a range tab re-fetches that range's series
 * and updates the chart, %-change badge, and period label together from
 * one response, never a stale combination — see `loadPortfolioHistory`
 * below. An empty `series` (both price sources unavailable) falls back to
 * `NetworkErrorBanner`, matching the balance/activity failure path,
 * rather than a broken/blank chart.
 *
 * The `Beam` identity divider (`packages/ui/src/primitives/beam.tsx`,
 * wallet-main-screen.html's `.beam-divider`) sits between the chart's
 * range-tabs and the Send/Receive actions row, matching the reference's
 * placement now that the chart exists.
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
  onViewAllTokens: () => void;
  onViewAllActivity: () => void;
  onOpenWalletSwitcher: () => void;
  onOpenSettings: () => void;
}

interface LoadState {
  balance: Winston | null;
  tokenBalances: TokenBalance[];
  activity: ActivityPage | null;
  loading: boolean;
  hasLoadedOnce: boolean;
  error: string | null;
}

interface PortfolioHistoryState {
  history: PortfolioHistory | null;
  loading: boolean;
  error: string | null;
}

export function MainScreenView({
  runtime,
  wallet,
  onSend,
  onSendToken,
  onReceive,
  onViewAllTokens,
  onViewAllActivity,
  onOpenWalletSwitcher,
  onOpenSettings,
}: MainScreenViewProps) {
  const [state, setState] = useState<LoadState>({
    balance: null,
    tokenBalances: [],
    activity: null,
    loading: true,
    hasLoadedOnce: false,
    error: null,
  });
  const [portfolioRange, setPortfolioRange] = useState<PortfolioHistoryRange>("7D");
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioHistoryState>({
    history: null,
    loading: true,
    error: null,
  });

  const avatarSvg = useMemo(() => generateAccountAvatarSvg(wallet.address), [wallet.address]);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [balance, tokenBalances, activity] = await Promise.all([
        runtime.send<{ address: string }, Winston>({
          type: "getBalance",
          payload: { address: wallet.address },
        }),
        runtime.send<{ address: string }, TokenBalance[]>({
          type: "getTokenBalances",
          payload: { address: wallet.address },
        }),
        runtime.send<{ address: string }, ActivityPage>({
          type: "getActivity",
          payload: { address: wallet.address },
        }),
      ]);
      setState({ balance, tokenBalances, activity, loading: false, hasLoadedOnce: true, error: null });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [runtime, wallet.address]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * `getPortfolioHistory` takes only `{ range }` (`ProtocolMap`'s locked
   * signature — no `address`; `ReadsHandler` resolves the active wallet
   * itself, see that file's doc comment), so this loader doesn't thread
   * `wallet.address` through. Re-runs whenever `portfolioRange` changes
   * (range-tab click), and always replaces the whole `PortfolioHistory`
   * response atomically — chart points, %-change, and period label come
   * from the same fetch, so a tab click can never show one range's chart
   * next to a different range's %-change/period label.
   */
  const loadPortfolioHistory = useCallback(
    async (range: PortfolioHistoryRange) => {
      setPortfolioHistory((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const history = await runtime.send<{ range: PortfolioHistoryRange }, PortfolioHistory>({
          type: "getPortfolioHistory",
          payload: { range },
        });
        setPortfolioHistory({ history, loading: false, error: null });
      } catch (error) {
        setPortfolioHistory((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [runtime],
  );

  useEffect(() => {
    void loadPortfolioHistory(portfolioRange);
  }, [loadPortfolioHistory, portfolioRange]);

  return (
    <div className="flex min-h-full flex-col">
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex items-center justify-between gap-2.5 px-5 pb-2.5 pt-4">
        <button
          type="button"
          onClick={onOpenWalletSwitcher}
          aria-haspopup="dialog"
          aria-label={`${wallet.name}, address ${wallet.address}, view account details`}
          className="-ml-3 flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-0 pr-2 hover:bg-mist"
        >
          <AccountAvatar svgMarkup={avatarSvg} label={`${wallet.name} avatar`} size={24} />
          <span className="truncate text-label">{wallet.name}</span>
          <span className="truncate font-mono text-label text-muted">
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

      <div className="px-5 pb-1">
        <StatusDot label="arweave.net" />
      </div>

      <div className="px-6 pb-1 pt-2.5">
        {portfolioHistory.error ? (
          <NetworkErrorBanner onRetry={() => void loadPortfolioHistory(portfolioRange)} />
        ) : (
          <PortfolioChart
            points={portfolioHistory.history?.series ?? []}
            currentUsdValue={portfolioHistory.history?.currentUsdValue ?? 0}
            usdChange={portfolioHistory.history?.usdChange ?? 0}
            periodLabel={portfolioHistory.history?.periodLabel ?? ""}
            activeRange={portfolioRange}
            onRangeChange={setPortfolioRange}
            loading={portfolioHistory.loading}
          />
        )}
      </div>

      <div className="px-6 pb-5 pt-3">
        <Beam />
      </div>

      <div className="px-6 pb-6">
        <SendReceiveActions onSend={onSend} onReceive={onReceive} />
      </div>

      <div className="px-6 pb-4">
        <div className="flex items-center justify-between pb-2.5">
          <span className="text-label font-semibold uppercase tracking-[0.04em] text-muted">
            Tokens
          </span>
          <button
            type="button"
            onClick={onViewAllTokens}
            className="text-label font-medium text-muted hover:text-foreground hover:underline"
          >
            View all
          </button>
        </div>
        <div className="border-t border-line">
          {state.loading && !state.hasLoadedOnce ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : state.tokenBalances.length === 0 ? (
            <EmptyState message="Nothing here yet. Send yourself something to get started." />
          ) : (
            state.tokenBalances.map((token) => (
              <TokenRow
                key={token.processId}
                glyph={{ label: token.ticker.slice(0, 2).toUpperCase(), tone: 2 }}
                name={token.ticker}
                ticker={token.ticker}
                amount={token.quantity}
                loading={state.loading}
                onClick={() => onSendToken(token)}
              />
            ))
          )}
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="flex items-center justify-between pb-2.5">
          <span className="text-label font-semibold uppercase tracking-[0.04em] text-muted">
            Activity
          </span>
          <button
            type="button"
            onClick={onViewAllActivity}
            className="text-label font-medium text-muted hover:text-foreground hover:underline"
          >
            View all
          </button>
        </div>
        <div className="border-t border-line">
          {state.loading && !state.hasLoadedOnce ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : !state.activity || state.activity.entries.length === 0 ? (
            <EmptyState message="No activity yet. Once you send, receive, or upload, it'll show up here." />
          ) : (
            state.activity.entries.slice(0, 5).map((entry) => (
              <ActivityRow
                key={entry.txId}
                activityType={entry.type}
                title={`${activityVerb(entry.type)} · ${truncateAddress(entry.address)}`}
                subtitle={entry.status === "pending" ? "Pending confirmation" : relativeTime(entry.timestamp)}
                amountLabel={entry.amount ? `${entry.type === "receive" ? "+" : "-"}${formatWinstonAsAr(entry.amount)} AR` : "—"}
                amountTone={entry.type === "receive" ? "positive" : "neutral"}
                pending={entry.status === "pending"}
              />
            ))
          )}
        </div>
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
