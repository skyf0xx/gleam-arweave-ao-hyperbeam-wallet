import { useCallback, useEffect, useState } from "react";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { useQueryClient } from "@tanstack/react-query";
import type { RuntimePort, TokenBalance } from "@gleam/core";
import { NetworkErrorBanner, SkeletonRow, TokenGlyph } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { formatAtomicAsDisplay } from "../../main-screen/src/formatWinston";
import { walletQueryKeys } from "../../activity/src/queryKeys";

/**
 * Reached from Settings. AR and AO aren't listed: they always show on the
 * main screen and can't be removed. Tokens the wallet has received show
 * up on their own ("Found in your wallet") and can be hidden; adding by id
 * is for a token the wallet hasn't received yet.
 */
export interface ManageTokensViewProps {
  runtime: RuntimePort;
  address: string;
  onBack: () => void;
}

const PROCESS_ID = /^[A-Za-z0-9_-]{43}$/;

interface LoadState {
  processIds: string[];
  discovered: TokenBalance[];
  balances: Map<string, TokenBalance>;
  loading: boolean;
  error: string | null;
}

export function ManageTokensView({ runtime, address, onBack }: ManageTokensViewProps) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LoadState>({
    processIds: [],
    discovered: [],
    balances: new Map(),
    loading: true,
    error: null,
  });
  const [newProcessId, setNewProcessId] = useState("");
  const [preview, setPreview] = useState<TokenBalance | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [processIds, tokenBalances] = await Promise.all([
        runtime.send<{ address: string }, string[]>({ type: "getWatchedTokens", payload: { address } }),
        runtime.send<{ address: string }, TokenBalance[]>({ type: "getTokenBalances", payload: { address } }),
      ]);
      const balances = new Map(tokenBalances.map((balance) => [balance.processId, balance]));
      const discovered = tokenBalances.filter((balance) => balance.source === "discovered");
      setState({ processIds, discovered, balances, loading: false, error: null });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [runtime, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const invalidateBalances = () => {
    void queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances(address) });
  };

  const handlePreview = async () => {
    const processId = newProcessId.trim();
    if (processId.length === 0) {
      setAddError("Paste a token's process id.");
      return;
    }
    if (!PROCESS_ID.test(processId)) {
      setAddError(
        `A process id is 43 letters, digits, - and _ (this is ${processId.length}). Copy the whole id from the token's page or explorer.`,
      );
      return;
    }
    if (state.processIds.includes(processId) || state.discovered.some((token) => token.processId === processId)) {
      setAddError("That token is already in your list.");
      return;
    }

    setAddError(null);
    setPreviewing(true);
    setPreview(null);
    try {
      const balance = await runtime.send<{ address: string; processId: string }, TokenBalance>({
        type: "previewWatchedToken",
        payload: { address, processId },
      });
      setPreview(balance);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmAdd = async () => {
    if (!preview) return;
    setAdding(true);
    try {
      await runtime.send<{ address: string; processId: string }, TokenBalance>({
        type: "addWatchedToken",
        payload: { address, processId: preview.processId },
      });
      setState((prev) => ({
        ...prev,
        processIds: [...prev.processIds, preview.processId],
        balances: new Map(prev.balances).set(preview.processId, preview),
      }));
      invalidateBalances();
      setPreview(null);
      setNewProcessId("");
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (processId: string) => {
    setRemovingId(processId);
    try {
      await runtime.send<{ address: string; processId: string }, void>({
        type: "removeWatchedToken",
        payload: { address, processId },
      });
      setState((prev) => ({
        ...prev,
        processIds: prev.processIds.filter((id) => id !== processId),
        discovered: prev.discovered.filter((token) => token.processId !== processId),
      }));
      invalidateBalances();
      if (preview?.processId === processId) setPreview(null);
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Manage tokens" onBack={onBack} />
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex flex-1 flex-col px-6 pb-6 pt-9">
        <div>
          <div className="border-b border-line pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">
            Watched AO tokens
          </div>
          <div>
            {state.loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : state.processIds.length === 0 ? (
              <p className="py-3.5 text-caption text-faint">
                No extra tokens added yet. AR and AO always show on the main screen.
              </p>
            ) : (
              state.processIds.map((processId) => {
                const balance = state.balances.get(processId);
                return (
                  <div key={processId} className="flex items-center gap-2.5 py-3.5">
                    {balance?.logoUrl ? (
                      <TokenGlyph label={balance.ticker.slice(0, 2).toUpperCase()} tone={2} logoUrl={balance.logoUrl} />
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-label font-semibold text-foreground">
                        {balance?.ticker ?? "Unavailable"}
                      </span>
                      <span className="truncate font-mono text-caption text-muted">{truncateAddress(processId, 6)}</span>
                    </span>
                    {balance ? (
                      <span
                        className="flex-shrink-0 font-mono text-label text-muted"
                        title={balance.available === false ? balance.unavailableReason : undefined}
                      >
                        {balance.available === false ? "Unavailable" : formatAtomicAsDisplay(balance.quantity, balance.denomination)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove ${balance?.ticker ?? processId}`}
                      disabled={removingId === processId}
                      onClick={() => void handleRemove(processId)}
                      className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-warning disabled:opacity-60"
                    >
                      <RemoveIcon />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {state.discovered.length > 0 ? (
          <div className="pt-10">
            <div className="border-b border-line pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">
              Found in your wallet
            </div>
            {state.discovered.map((token) => (
              <div key={token.processId} className="flex items-center gap-2.5 py-3.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-label font-semibold text-foreground">{token.ticker}</span>
                  <span className="truncate font-mono text-caption text-muted">{truncateAddress(token.processId, 6)}</span>
                </span>
                <span className="flex-shrink-0 font-mono text-label text-muted">
                  {formatAtomicAsDisplay(token.quantity, token.denomination)}
                </span>
                <button
                  type="button"
                  aria-label={`Hide ${token.ticker}`}
                  disabled={removingId === token.processId}
                  onClick={() => void handleRemove(token.processId)}
                  className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-warning disabled:opacity-60"
                >
                  <RemoveIcon />
                </button>
              </div>
            ))}
            <p className="pt-1 text-caption leading-relaxed text-faint">
              Anyone can send you a token, so these aren&apos;t vetted and are never priced. Hide one you don&apos;t want.
            </p>
          </div>
        ) : null}

        <div className="pt-10">
          <div className="border-b border-line pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">
            Add a token
          </div>
          <div className="flex flex-col gap-2 py-3.5">
            <input
              type="text"
              placeholder="AO process id"
              value={newProcessId}
              onChange={(event) => {
                setNewProcessId(event.target.value);
                setAddError(null);
                setPreview(null);
              }}
              onBlur={() => void handlePreview()}
              className="w-full rounded-md border border-line bg-background px-3 py-2 font-mono text-label text-foreground focus:border-foreground focus:outline-none"
            />
            {addError ? (
              <span role="alert" className="text-caption text-warning">
                {addError}
              </span>
            ) : null}
            {previewing ? <SkeletonRow /> : null}
            {preview ? (
              <div className="flex flex-col gap-1 py-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5 text-label font-semibold text-foreground">
                    {preview.logoUrl ? (
                      <TokenGlyph label={preview.ticker.slice(0, 2).toUpperCase()} tone={2} logoUrl={preview.logoUrl} />
                    ) : null}
                    <span>
                      {preview.ticker}
                      {preview.name && preview.name !== preview.ticker ? (
                        <span className="font-normal text-muted"> · {preview.name}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="font-mono text-label text-muted">
                    {preview.available === false ? "Unavailable" : formatAtomicAsDisplay(preview.quantity, preview.denomination)}
                  </span>
                </div>
                {preview.available === false ? (
                  <span className="text-caption leading-snug text-muted">
                    {preview.unavailableReason ?? "Its balance can't be read right now."} You can still add it; the
                    balance shows once it can be read.
                  </span>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              disabled={previewing || adding || (!preview && newProcessId.trim().length === 0)}
              onClick={() => void (preview ? handleConfirmAdd() : handlePreview())}
              className="flex w-full items-center gap-2 py-1 text-left text-label font-semibold text-muted hover:text-foreground disabled:opacity-60"
            >
              <PlusIcon />
              {adding ? "Adding…" : preview ? `Add ${preview.ticker}` : "Preview"}
            </button>
          </div>
          <p className="pt-2.5 text-caption leading-relaxed text-faint">
            Tokens you receive show up on their own. To watch one you haven&apos;t received yet, paste its process id,
            check the preview, then add it. Adding a hidden token by id brings it back.
          </p>
        </div>
      </div>
    </div>
  );
}

function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
