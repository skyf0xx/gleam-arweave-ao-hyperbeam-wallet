import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RuntimePort } from "@gleam/core";
import { readRowVisibility, writeRowVisibility, type RowVisibility } from "../../../token-visibility";
import { walletQueryKeys } from "../../activity";
import type { WalletBalances } from "../../activity";
import type { ListedTokenRow } from "./tokenRows";

/** Which token rows are hidden, and the in-place ignore flow (confirm, then remove the watched token). */
export function useTokenRowControls(runtime: RuntimePort, address: string) {
  const queryClient = useQueryClient();
  // Tagged with its address so a wallet switch reads that wallet's choices without an effect.
  const [storedVisibility, setStoredVisibility] = useState(() => ({
    address,
    rows: readRowVisibility(address),
  }));
  const rowVisibility =
    storedVisibility.address === address ? storedVisibility.rows : readRowVisibility(address);
  const isRowHidden = (row: ListedTokenRow) =>
    rowVisibility[row.key] === "hidden" || (rowVisibility[row.key] !== "shown" && row.defaultHidden);
  const toggleRowHidden = (row: ListedTokenRow) => {
    const rows: RowVisibility = { ...rowVisibility, [row.key]: isRowHidden(row) ? "shown" : "hidden" };
    setStoredVisibility({ address, rows });
    writeRowVisibility(address, rows);
  };
  // A set, so several rows can wait on their confirm at once.
  const [confirmingIgnore, setConfirmingIgnore] = useState<ReadonlySet<string>>(() => new Set());
  const [ignoreFailed, setIgnoreFailed] = useState(false);
  const setConfirming = (processId: string, on: boolean) =>
    setConfirmingIgnore((current) => {
      const next = new Set(current);
      if (on) next.add(processId);
      else next.delete(processId);
      return next;
    });
  const ignoreToken = async (processId: string) => {
    setIgnoreFailed(false);
    setConfirming(processId, false);
    const balancesKey = walletQueryKeys.balances(address);
    // The row goes now: waiting on a full balance read (every token process, then discovery) took seconds.
    // A read already in flight started before the write, so it would bring the token back.
    await queryClient.cancelQueries({ queryKey: balancesKey });
    queryClient.setQueryData<WalletBalances>(balancesKey, (data) =>
      data ? { ...data, tokenBalances: data.tokenBalances.filter((token) => token.processId !== processId) } : data,
    );
    try {
      await runtime.send<{ address: string; processId: string }, void>({
        type: "removeWatchedToken",
        payload: { address, processId },
      });
      // Dropped so a token added back by id isn't still filed under Hidden. Read fresh: another ignore may have landed meanwhile.
      const stored = readRowVisibility(address);
      const rows: RowVisibility = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== processId));
      setStoredVisibility({ address, rows });
      writeRowVisibility(address, rows);
    } catch {
      setIgnoreFailed(true);
      void queryClient.invalidateQueries({ queryKey: balancesKey });
    }
  };
  return {
    rowVisibility,
    isRowHidden,
    toggleRowHidden,
    confirmingIgnore,
    setConfirmingIgnore,
    ignoreFailed,
    setIgnoreFailed,
    setConfirming,
    ignoreToken,
  };
}

export type TokenRowControls = ReturnType<typeof useTokenRowControls>;
