import { useCallback, useEffect, useState } from "react";
import type { RuntimePort, WalletState, WalletSummary } from "@gleam/core";
import { AccountAvatar, MemorableAddress, NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { useAddressIdentity } from "../../../address-identity";
import { useCopy } from "../../points/src/useCopy";
import { useLocale, useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { CheckIcon, CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";

// JWK is what nearly every wallet is, so only the other methods get a label.
// The label sits inside the name's truncating span, so a narrow row cuts
// the label before the name. Hardware brands stay untranslated.
const WALLET_METHOD_LABEL: Record<Exclude<WalletSummary["method"], "watch">, string | null> = {
  jwk: null,
  ethereum: "Ethereum",
  ledger: "Ledger",
  keystone: "Keystone",
};

/**
 * The sheet opened from the main screen's account pill. Lists every stored
 * wallet from `getState()` in saved order, marks the active one with a
 * checkmark, and
 * switches on tap via `switchWallet`.
 *
 * "Add wallet" hands off to the add-wallet flow through `onAddWallet`. The
 * per-row "manage" chevron opens the wallet detail screen (rename/back up)
 * through `onManage`.
 *
 * Each wallet's row uses the same dicebear identicon as the main screen's
 * account pill (`AccountAvatar` + `src/account-avatar.ts`'s
 * `avatarSvg`, keyed on `wallet.address`, computed locally
 * with no network call) so the same wallet shows the same identity mark on
 * both screens.
 */
export interface WalletSwitcherViewProps {
  runtime: RuntimePort;
  /** Shown at once, so the remount that follows a switch doesn't flash a skeleton. */
  initialWallets?: WalletSummary[];
  initialActiveWalletId?: string | null;
  onSwitched: (walletId: string) => void;
  onBack: () => void;
  onAddWallet: () => void;
  onManage: (walletId: string) => void;
}

interface LoadState {
  wallets: WalletSummary[];
  activeWalletId: string | null;
  loading: boolean;
  error: string | null;
}

/** "Wallet 2" before "Wallet 10", and case and accents don't split names apart. */
export function sortByName(wallets: WalletSummary[], locale: string): WalletSummary[] {
  return [...wallets].sort((a, b) => a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: "base" }));
}

export function WalletSwitcherView({ runtime, initialWallets, initialActiveWalletId = null, onSwitched, onBack, onAddWallet, onManage }: WalletSwitcherViewProps) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = useState<LoadState>({
    wallets: initialWallets ?? [],
    activeWalletId: initialActiveWalletId,
    loading: !initialWallets?.length,
    error: null,
  });
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: prev.wallets.length === 0, error: null }));
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
        error: errorText(error),
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
      setState((prev) => ({ ...prev, activeWalletId: walletId }));
      onSwitched(walletId);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: errorText(error),
      }));
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label={t("walletSwitcher.switchWallet")}>
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <ScreenHeader title={t("walletSwitcher.wallets")} onBack={onBack} />

      <div className="px-6 phone:px-5 pb-3 pt-9 phone:pt-4">
        <div>
          {state.loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            // By name, never active-first: a list that reshuffles on every switch loses people.
            sortByName(state.wallets, locale).map((wallet) => (
              <WalletSwitcherRow
                key={wallet.id}
                wallet={wallet}
                active={wallet.id === state.activeWalletId}
                switching={switchingId === wallet.id}
                onSwitch={() => void handleSwitch(wallet.id)}
                onManage={() => onManage(wallet.id)}
              />
            ))
          )}
        </div>

        <button
          type="button"
          onClick={onAddWallet}
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-hover"
        >
          <span
            aria-hidden="true"
            className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-2xl border border-dashed border-line text-muted"
          >
            <PlusIcon />
          </span>
          <span className="text-label font-semibold text-foreground">{t("walletSwitcher.addWallet")}</span>
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
  onManage: () => void;
}

function WalletSwitcherRow({ wallet, active, switching, onSwitch, onManage }: WalletSwitcherRowProps) {
  const t = useT();
  const identity = useAddressIdentity();
  const avatarSvg = identity.avatarSvg(wallet.address);
  const methodLabel = wallet.method === "watch" ? t("common.watchOnly") : WALLET_METHOD_LABEL[wallet.method];
  const { copied, copy } = useCopy(wallet.address);
  const activeBadge = active ? (
    <span className="shrink-0 whitespace-pre">
      <span className="text-faint"> · </span>
      <span className="font-medium text-positive">{t("walletSwitcher.active")}</span>
    </span>
  ) : null;

  return (
    // The row bleeds 8px past the list edge so the hover fill has room
    // around its content while text stays aligned with the header. A green
    // fill and label mark the active row; grey is hover. In silica the active
    // row is under a lens instead. Copy
    // floats beside the chevron instead of taking a column, so the address
    // keeps the full width for its 7-chunk first row.
    <div
      className={`group relative -mx-2 flex items-center gap-1 rounded-xl pl-2 pr-1 ${active ? "gleam-lens bg-positive/[0.06]" : "hover:bg-hover"}`}
    >
      <button
        type="button"
        disabled={switching}
        onClick={onSwitch}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left disabled:opacity-60"
      >
        {/* The dot breaks the avatar's outline, so the active wallet shows in the avatar column before any text is read. It takes the Active label's green so the two read as one signal. */}
        <span className="relative flex-shrink-0">
          <AccountAvatar svgMarkup={avatarSvg} label={t("walletSwitcher.avatarOf", { name: wallet.name })} size={36} />
          {active ? (
            <span aria-hidden="true" className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-positive ring-2 ring-background" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline text-label">
            <span className="truncate font-semibold text-foreground">
              {wallet.name}
              {methodLabel ? <span className="font-normal text-faint"> · {methodLabel}</span> : null}
            </span>
            {/* Outside the truncating span so a long name can't clip it. */}
            {activeBadge}
          </span>
          <span>
            {/* The phone's copy and manage tap targets leave too little width for the chunked address, so it runs as plain wrapped text there. */}
            <MemorableAddress address={wallet.address} emphasisPick={identity.emphasisPick} className="-ml-[0.35ch] phone:hidden" />
            <span translate="no" className="hidden break-all font-mono text-caption leading-relaxed text-muted phone:block">
              {wallet.address}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? t("walletSwitcher.addressCopied", { name: wallet.name }) : t("walletSwitcher.copyAddressOf", { name: wallet.name })}
        title={copied ? t("walletSwitcher.copied") : t("walletSwitcher.copyAddress")}
        className={`absolute right-[30px] top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md transition-opacity hover:bg-background ${active ? "silica:hover:bg-hover" : ""} focus-visible:opacity-100 group-hover:opacity-100 phone:static phone:h-11 phone:w-11 phone:shrink-0 phone:translate-y-0 phone:opacity-100 ${copied ? "text-positive opacity-100" : "text-faint opacity-0 hover:text-foreground"}`}
      >
        {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      </button>
      <button
        type="button"
        aria-label={t("walletSwitcher.manage", { name: wallet.name })}
        onClick={onManage}
        className={`flex h-7 w-5 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-background hover:text-foreground phone:h-11 phone:w-11 ${active ? "silica:hover:bg-hover" : ""}`}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

/** Opens the wallet's own page, so it reads as a way in, not a menu. */
function ChevronRightIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
