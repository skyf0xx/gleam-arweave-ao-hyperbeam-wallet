import { useEffect, useState } from "react";
import type { ActivityPage, RuntimePort, TokenBalance, WalletSummary, Winston } from "@gleam/core";
import {
  ActivityRow,
  BalanceDisplay,
  EmptyState,
  NetworkErrorBanner,
  SendReceiveActions,
  SkeletonRow,
  TokenRow,
} from "@gleam/ui/src/components/wallet/index.ts";
import { formatWinstonAsAr, truncateAddress } from "./formatWinston";

/**
 * Main screen (wallet-main-screen.html) — porting only what's already
 * gettable via this task's `ProtocolMap` reads: AR balance, AO token
 * balances (empty until a "watch a token" flow exists — see
 * `handlers/reads.ts`'s doc comment), and the merged activity feed.
 * wallet-main-screen.html's 7-day USD chart/range-tabs are omitted here:
 * they need historical price time series, which `core/pricing` (spot
 * price only, per this task's scope) doesn't provide, and no layer's
 * ALLOWED SCOPE names a historical-price source — reported as a gap in
 * this task's final report rather than faked with placeholder data.
 */
export interface MainScreenViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onSend: () => void;
  onReceive: () => void;
  onViewAllActivity: () => void;
}

interface LoadState {
  balance: Winston | null;
  tokenBalances: TokenBalance[];
  activity: ActivityPage | null;
  loading: boolean;
  error: string | null;
}

export function MainScreenView({ runtime, wallet, onSend, onReceive, onViewAllActivity }: MainScreenViewProps) {
  const [state, setState] = useState<LoadState>({
    balance: null,
    tokenBalances: [],
    activity: null,
    loading: true,
    error: null,
  });

  const load = async () => {
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
  };

  useEffect(() => {
    void load();
  }, [wallet.address]);

  return (
    <div className="flex min-h-full flex-col">
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex items-center justify-between gap-2.5 px-5 pb-2.5 pt-4">
        <div className="-ml-3 flex min-w-0 items-center gap-2 rounded-[10px] py-1.5 pl-0 pr-2">
          <span className="truncate text-[13px]">{wallet.name}</span>
          <span className="truncate font-mono text-[13px] text-[#737373]">
            {truncateAddress(wallet.address)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-5 pb-1">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
        <span className="text-[11px] text-[#737373]">arweave.net</span>
      </div>

      <div className="px-6 pb-1 pt-2.5">
        <BalanceDisplay
          amountLabel={state.balance !== null ? `${formatWinstonAsAr(state.balance)} AR` : "—"}
          loading={state.loading}
        />
      </div>

      <div className="px-6 pb-6 pt-3">
        <SendReceiveActions onSend={onSend} onReceive={onReceive} />
      </div>

      <div className="px-6 pb-4">
        <div className="pb-2.5 text-xs font-semibold uppercase tracking-[0.04em] text-[#737373]">
          Tokens
        </div>
        <div className="rounded-[10px] border border-[#e5e5e5] px-3">
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
          <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[#737373]">
            Activity
          </span>
          <button
            type="button"
            onClick={onViewAllActivity}
            className="text-xs font-medium text-[#111111] underline decoration-[#a3a3a3] underline-offset-2"
          >
            View all
          </button>
        </div>
        <div className="rounded-[10px] border border-[#e5e5e5] px-3">
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
