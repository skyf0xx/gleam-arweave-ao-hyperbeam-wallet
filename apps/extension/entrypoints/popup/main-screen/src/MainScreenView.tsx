import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityPage,
  RuntimePort,
  ThemePreference,
  ThemeSettings,
  TokenBalance,
  WalletSummary,
  Winston,
} from "@gleam/core";
import {
  ActivityRow,
  BalanceDisplay,
  EmptyState,
  NetworkErrorBanner,
  SendReceiveActions,
  SkeletonRow,
  TokenRow,
} from "@gleam/ui/src/components/wallet/index.ts";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { StatusDot } from "@gleam/ui/src/primitives/status-dot.tsx";
import { formatWinstonAsAr, truncateAddress } from "./formatWinston";

/**
 * Main screen (wallet-main-screen.html) — porting only what's already
 * gettable via this task's `ProtocolMap` reads: AR balance, AO token
 * balances (empty until a "watch a token" flow exists — see
 * `handlers/reads.ts`'s doc comment), and the merged activity feed.
 * wallet-main-screen.html's 7-day USD chart/range-tabs are still omitted
 * here: they need historical price time series, which `core/pricing`
 * (spot price only) doesn't provide — tracked as separate change-work
 * (a new historical-price capability) rather than built here or faked
 * with placeholder data.
 *
 * The `Beam` identity divider (`packages/ui/src/primitives/beam.tsx`,
 * wallet-main-screen.html's `.beam-divider`) is wired in directly above
 * the Send/Receive actions row — the reference places it between the
 * chart's range-tabs and Send/Receive, so this is that same slot with
 * the not-yet-built range-tabs simply absent from it.
 *
 * Navigation entry points (settings-screens-gap): the account pill's
 * chevron (wallet-main-screen.html's `.account-pill`) opens the wallet
 * switcher via `onOpenWalletSwitcher`; the header's gear icon
 * (`.icon-btn[aria-label="Settings"]`) opens a small inline menu listing
 * "Lock & auto-lock" and "Network & peers" — the only two settings
 * screens this intent builds. A full settings-home screen (TODO.md
 * §7.2, every other settings category) is explicitly out of this
 * intent's scope, so the gear opens this minimal two-item menu directly
 * rather than a dedicated settings-home screen that doesn't exist yet;
 * see this task's final report.
 *
 * The gear menu's third item (this task, settings-screens-gap) is a
 * Light/Dark toggle rather than a navigation entry, since there is no
 * separate theme screen — it reads/writes `ThemeSettings` via
 * `getThemePreference`/`setThemePreference` directly (own mount-time
 * fetch, matching this component's existing pattern of fetching its own
 * data rather than threading it from `App.tsx`, which is out of this
 * layer's scope) and, per wallet-core's inherited decision, re-applies
 * `data-theme` immediately by setting it on `document.documentElement`
 * rather than only on `App.tsx`'s root div — there is no storage-change
 * listener anywhere in this codebase, so without this the flipped
 * surface would not reflect the change until closed and reopened. The
 * dark-mode token block in `theme.css` matches `[data-theme="dark"]` on
 * *any* ancestor, so setting it on `documentElement` (an ancestor of
 * `App.tsx`'s own root div) is equivalent for styling purposes and
 * doesn't require touching `App.tsx`, which is wallet-core's locked
 * scope.
 */
export interface MainScreenViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onSend: () => void;
  onReceive: () => void;
  onViewAllActivity: () => void;
  onOpenWalletSwitcher: () => void;
  onOpenLockSettings: () => void;
  onOpenNetworkPeers: () => void;
}

interface LoadState {
  balance: Winston | null;
  tokenBalances: TokenBalance[];
  activity: ActivityPage | null;
  loading: boolean;
  error: string | null;
}

export function MainScreenView({
  runtime,
  wallet,
  onSend,
  onReceive,
  onViewAllActivity,
  onOpenWalletSwitcher,
  onOpenLockSettings,
  onOpenNetworkPeers,
}: MainScreenViewProps) {
  const [state, setState] = useState<LoadState>({
    balance: null,
    tokenBalances: [],
    activity: null,
    loading: true,
    error: null,
  });
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [savingTheme, setSavingTheme] = useState(false);

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
      setState({ balance, tokenBalances, activity, loading: false, error: null });
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
   * This screen's own theme read, separate from `App.tsx`'s pre-paint
   * `applyTheme` gate — `App.tsx` is out of this layer's scope, so its
   * fetched value can't be threaded down as a prop without editing it.
   * A failed read (e.g. background dispatcher unreachable) falls back to
   * light, matching every other fallback in this codebase's theme wiring.
   */
  useEffect(() => {
    let cancelled = false;
    const applyDocumentTheme = (value: ThemePreference) => {
      if (value === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    };
    runtime
      .send<void, ThemeSettings>({ type: "getThemePreference", payload: undefined })
      .then((settings) => {
        if (cancelled) return;
        setTheme(settings.theme);
        applyDocumentTheme(settings.theme);
      })
      .catch(() => {
        if (cancelled) return;
        setTheme("light");
        applyDocumentTheme("light");
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  useEffect(() => {
    if (!settingsMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [settingsMenuOpen]);

  const handleToggleTheme = async () => {
    const next: ThemePreference = theme === "dark" ? "light" : "dark";
    const previous = theme;
    setTheme(next);
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    setSavingTheme(true);
    try {
      await runtime.send<ThemeSettings, void>({ type: "setThemePreference", payload: { theme: next } });
    } catch (error) {
      setTheme(previous);
      if (previous === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSavingTheme(false);
    }
  };

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
          <span className="truncate text-label">{wallet.name}</span>
          <span className="truncate font-mono text-label text-muted">
            {truncateAddress(wallet.address)}
          </span>
          <span aria-hidden="true" className="flex-shrink-0 text-faint">
            <ChevronIcon />
          </span>
        </button>

        <div ref={settingsMenuRef} className="relative flex-shrink-0">
          <button
            type="button"
            aria-label="Settings"
            aria-haspopup="menu"
            aria-expanded={settingsMenuOpen}
            onClick={() => setSettingsMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground"
          >
            <SettingsIcon />
          </button>
          {settingsMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+4px)] z-10 w-48 rounded-xl border border-line bg-background py-1.5 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSettingsMenuOpen(false);
                  onOpenLockSettings();
                }}
                className="flex w-full items-center px-3.5 py-2.5 text-left text-label font-semibold text-foreground hover:bg-mist"
              >
                Lock &amp; auto-lock
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSettingsMenuOpen(false);
                  onOpenNetworkPeers();
                }}
                className="flex w-full items-center px-3.5 py-2.5 text-left text-label font-semibold text-foreground hover:bg-mist"
              >
                Network &amp; peers
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={theme === "dark"}
                disabled={savingTheme}
                onClick={() => void handleToggleTheme()}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-label font-semibold text-foreground hover:bg-mist disabled:opacity-60"
              >
                <span>Dark mode</span>
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                    theme === "dark" ? "bg-foreground" : "bg-line"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                      theme === "dark" ? "translate-x-[18px]" : "translate-x-[2px]"
                    }`}
                  />
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-5 pb-1">
        <StatusDot label="arweave.net" />
      </div>

      <div className="px-6 pb-1 pt-2.5">
        <BalanceDisplay
          amountLabel={state.balance !== null ? `${formatWinstonAsAr(state.balance)} AR` : "—"}
          loading={state.loading}
        />
      </div>

      <div className="px-6 pb-5 pt-3">
        <Beam />
      </div>

      <div className="px-6 pb-6">
        <SendReceiveActions onSend={onSend} onReceive={onReceive} />
      </div>

      <div className="px-6 pb-4">
        <div className="pb-2.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">
          Tokens
        </div>
        <div className="rounded-xl border border-line px-3">
          {state.loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : state.tokenBalances.length === 0 ? (
            <EmptyState message="Nothing here yet. Send yourself something to test the waters." />
          ) : (
            state.tokenBalances.map((token) => (
              <TokenRow
                key={token.processId}
                glyph={{ label: token.ticker.slice(0, 2).toUpperCase(), tone: 2 }}
                name={token.ticker}
                ticker={token.ticker}
                amount={token.quantity}
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
            className="text-label font-medium text-foreground underline decoration-faint underline-offset-2"
          >
            View all
          </button>
        </div>
        <div className="rounded-xl border border-line px-3">
          {state.loading ? (
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
