import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isValidArweaveAddress, type RuntimePort, type TokenBalance } from "@gleam/core";
import { NetworkErrorBanner, TokenGlyph } from "@gleam/ui/src/components/wallet/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT } from "../../../i18n";
import { displayTicker, formatAtomicAsDisplay } from "../../main-screen/src/formatWinston";
import { walletQueryKeys } from "../../activity/src/queryKeys";
import { errorText } from "../../../i18n/errors";

/**
 * Adds a token by its process id, for one the wallet hasn't received yet.
 * Reached from the token list's edit mode, which hides, shows and ignores
 * the tokens already listed; it goes back there once the token is added.
 */
export interface ManageTokensViewProps {
  runtime: RuntimePort;
  address: string;
  onBack: () => void;
}


interface LoadState {
  processIds: string[];
  discovered: TokenBalance[];
  balances: Map<string, TokenBalance>;
  loading: boolean;
  error: string | null;
}

export function ManageTokensView({ runtime, address, onBack }: ManageTokensViewProps) {
  const t = useT();
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
  // The id in the field now, so a preview that resolves after the field changed is dropped.
  const currentIdRef = useRef("");

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
        error: errorText(error),
      }));
    }
  }, [runtime, address]);

  useEffect(() => {
    void load();
  }, [load]);

  const invalidateBalances = () => {
    void queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances(address) });
  };

  const handlePreview = async (processId: string) => {
    if (!isValidArweaveAddress(processId)) {
      setAddError(t("manageTokens.badIdLength", { length: processId.length }));
      return;
    }
    if (state.processIds.includes(processId) || state.discovered.some((token) => token.processId === processId)) {
      setAddError(t("manageTokens.alreadyListed"));
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
      if (currentIdRef.current === processId) setPreview(balance);
    } catch (error) {
      if (currentIdRef.current === processId) setAddError(errorText(error));
    } finally {
      if (currentIdRef.current === processId) setPreviewing(false);
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
      invalidateBalances();
      onBack();
    } catch (error) {
      setAddError(errorText(error));
      setAdding(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("manageTokens.add")} onBack={onBack} />
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex flex-1 flex-col px-6 phone:px-5 pb-6 pt-6 phone:pt-4">
        <div>
          <div className="flex flex-col gap-2 py-3.5">
            <input
              type="text"
              placeholder={t("manageTokens.placeholder")}
              value={newProcessId}
              onChange={(event) => {
                const processId = event.target.value.trim();
                currentIdRef.current = processId;
                setNewProcessId(event.target.value);
                setAddError(null);
                setPreview(null);
                setPreviewing(false);
                // A whole id previews at once, pasted or typed; anything shorter waits for blur to explain itself.
                if (isValidArweaveAddress(processId)) void handlePreview(processId);
              }}
              onBlur={() => {
                const processId = newProcessId.trim();
                if (processId.length > 0 && !isValidArweaveAddress(processId)) void handlePreview(processId);
              }}
              className="w-full border-0 border-b border-line bg-transparent px-0 py-2.5 font-mono text-label text-foreground focus:outline-none"
            />
            {addError ? (
              <InlineError as="span">
                {addError}
              </InlineError>
            ) : null}
            {previewing ? <TokenSkeletonRow className="py-1" /> : null}
            {preview ? (
              <div className="flex flex-col gap-1 py-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5 text-label font-semibold text-foreground">
                    {preview.logoUrl ? (
                      <TokenGlyph label={preview.ticker.slice(0, 2).toUpperCase()} tone={2} logoUrl={preview.logoUrl} />
                    ) : null}
                    <span className="truncate">
                      {displayTicker(preview.ticker)}
                      {preview.name && preview.name !== preview.ticker ? (
                        <span className="font-normal text-muted"> · {preview.name}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="flex-shrink-0 font-mono text-label text-muted">
                    {preview.available === false ? t("manageTokens.unavailable") : formatAtomicAsDisplay(preview.quantity, preview.denomination)}
                  </span>
                </div>
                {preview.available === false ? (
                  <div className="flex flex-col gap-2 text-caption leading-snug text-muted" title={preview.unavailableReason ? errorText(preview.unavailableReason) : undefined}>
                    <p>{t("manageTokens.unreadable")}</p>
                    <p>{t("manageTokens.unreadableAdd")}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {preview ? (
              <Button className="mt-1" disabled={adding} onClick={() => void handleConfirmAdd()}>
                {adding
                  ? t("manageTokens.adding")
                  : preview.ticker === preview.processId
                    ? t("manageTokens.addToken")
                    : t("manageTokens.addNamed", { token: preview.ticker })}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Shaped like the rows on this screen (no glyph, no divider), with each
 * bar as tall as the text line it stands in for, so nothing moves when
 * the real row replaces it.
 */
function TokenSkeletonRow({ className = "py-3.5" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex items-center gap-2.5 ${className}`}>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="w-16 rounded-md text-label gleam-shimmer">&nbsp;</span>
        <span className="w-28 rounded-md text-caption gleam-shimmer">&nbsp;</span>
      </span>
      <span className="w-12 rounded-md text-label gleam-shimmer">&nbsp;</span>
    </div>
  );
}
