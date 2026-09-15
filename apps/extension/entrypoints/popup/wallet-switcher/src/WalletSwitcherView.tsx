import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { AccountAvatar, NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { generateAccountAvatarSvg } from "../../main-screen/src/generateAccountAvatar";

const WALLET_METHOD_LABEL: Record<WalletSummary["method"], string> = {
  jwk: "JWK",
  ethereum: "ETH",
  ledger: "LEDGER",
};

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

/**
 * Wallet switcher (wallet-switcher.html / TODO.md 7.1) — the sheet opened
 * from the main screen's account pill. Lists every stored wallet from
 * `getState()`, marks the active one with a checkmark, and switches on tap
 * via `switchWallet`. No new backend needed (RELEVANT RULES): `getState`
 * already returns `{ wallets, activeWalletId }` and `switchWallet` is
 * already implemented and wired.
 *
 * "Add wallet" and the per-row "manage" kebab (wallet-switcher.html) have
 * no backing screen or action anywhere in this task's ALLOWED SCOPE — no
 * `ProtocolMap` method or popup screen for either exists yet. Rendered as
 * visual affordances matching the mockup but inert (no `onClick`) rather
 * than invented behavior; see this task's final report.
 *
 * Per-row identity: each wallet's row uses the same dicebear identicon as
 * the main screen's account pill (`AccountAvatar` +
 * `./generateAccountAvatar.ts`'s `generateAccountAvatarSvg`, keyed on
 * `wallet.address`, computed locally with no network call) rather than a
 * plain letter-initial glyph, so the same wallet shows the same identity
 * mark on both screens — this is the cross-screen consistency this layer
 * exists to catch, not a new design decision.
 */
export interface WalletSwitcherViewProps {
  runtime: RuntimePort;
  onSwitched: (walletId: string) => void;
  onBack: () => void;
}

interface LoadState {
  wallets: WalletSummary[];
  activeWalletId: string | null;
  loading: boolean;
  error: string | null;
}

export function WalletSwitcherView({ runtime, onSwitched, onBack }: WalletSwitcherViewProps) {
  const [state, setState] = useState<LoadState>({
    wallets: [],
    activeWalletId: null,
    loading: true,
    error: null,
  });
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await runtime.send<void, WalletState>({ type: "getState", payload: undefined });
      setState({
        wallets: result.wallets,
        activeWalletId: result.activeWalletId,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSwitch = async (walletId: string) => {
    if (walletId === state.activeWalletId) return;
    setSwitchingId(walletId);
    try {
      await runtime.send<{ walletId: string }, void>({ type: "switchWallet", payload: { walletId } });
      onSwitched(walletId);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Switch wallet">
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <ScreenHeader title="Wallets" onBack={onBack} />

      <div className="flex flex-1 flex-col px-3 pb-3">
        {state.loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : (
          state.wallets.map((wallet) => (
            <WalletSwitcherRow
              key={wallet.id}
              wallet={wallet}
              active={wallet.id === state.activeWalletId}
              switching={switchingId === wallet.id}
              onSwitch={() => void handleSwitch(wallet.id)}
            />
          ))
        )}

        <div className="mx-2 my-1.5 h-px bg-line" />

        <button
          type="button"
          className="mt-1 flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-mist"
        >
          <span
            aria-hidden="true"
            className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-2xl border border-dashed border-line text-muted"
          >
            <PlusIcon />
          </span>
          <span className="text-label font-semibold text-foreground">Add wallet</span>
        </button>
      </div>
    </div>
  );
}

interface WalletSwitcherRowProps {
  wallet: WalletSummary;
  active: boolean;
  switching: boolean;
  onSwitch: () => void;
}

function WalletSwitcherRow({ wallet, active, switching, onSwitch }: WalletSwitcherRowProps) {
  const avatarSvg = useMemo(() => generateAccountAvatarSvg(wallet.address), [wallet.address]);

  return (
    <div
      className={`flex items-center gap-1 rounded-xl border px-2 py-1 ${
        active ? "border-line bg-mist" : "border-transparent"
      }`}
    >
      <button
        type="button"
        disabled={switching}
        onClick={onSwitch}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1.5 text-left hover:bg-mist disabled:opacity-60"
      >
        <AccountAvatar svgMarkup={avatarSvg} label={`${wallet.name} avatar`} size={34} className="rounded-2xl" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-label font-semibold text-foreground">{wallet.name}</span>
            <span className="flex-shrink-0 rounded-md border border-line bg-mist px-1.5 py-0.5 text-[10px] font-semibold text-muted">
              {WALLET_METHOD_LABEL[wallet.method]}
            </span>
          </span>
          <span className="truncate font-mono text-caption text-faint">{truncateAddress(wallet.address)}</span>
        </span>
        {active ? (
          <span aria-hidden="true" className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-foreground">
            <CheckIcon />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label={`Manage ${wallet.name}`}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-faint hover:bg-background hover:text-foreground"
      >
        <KebabIcon />
      </button>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
