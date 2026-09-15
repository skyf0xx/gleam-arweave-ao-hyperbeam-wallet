import { useCallback, useEffect, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ActivityPage, FeeEstimate, RuntimePort, TokenBalance, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { EmptyState, TokenRow } from "@gleam/ui/src/components/wallet/index.ts";
import { formatWinstonAsAr, truncateAddress } from "../../main-screen/src/formatWinston";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { useSubmitTransfer } from "../../activity/src/useSubmitTransfer";
import { validateSendAmount } from "../../activity/src/validateSendAmount";

const WINSTON_PER_AR = 1_000_000_000_000n;

/**
 * Send flow (send-flow.html / TODO.md §2) — compose → review → success,
 * internal step state only (same "no router" pattern as
 * Onboarding/UnlockView). `ComposeStep`/`ReviewStep`/`SuccessStep` below
 * are pure render helpers, not independently-mounted steps, matching how
 * `OnboardingView` structures its own switch. `TokenPickerStep`/
 * `RecentRecipientsStep` (added by AO-SEND-UI-WALLET-CORE) are two more
 * pushed screens in the same internal `Step` union, following this
 * codebase's established "pushed screen with ScreenHeader + rows" pattern
 * (`WalletSwitcherView.tsx`) rather than a dropdown/modal primitive — none
 * exists in this project and none is needed here either.
 *
 * No password prompt here: `estimateTransfer`/`submitTransfer` read the
 * signing key from the background's in-memory unlocked-session cache
 * (`apps/extension/src/handlers/key-session.ts`), not from this request —
 * see that file's doc comment. `App.tsx`'s `resolveTopView` already keeps
 * an unauthenticated user on the unlock screen, so `SendView` only ever
 * mounts once a wallet is unlocked.
 *
 * `token` (added by AO-TOKEN-SEND-WALLET-CORE, now mutable in-flow by
 * AO-SEND-UI-WALLET-CORE): the initial value is still `App.tsx`'s
 * entry-point context (`null` for the top-level "Send" action, a
 * `TokenBalance` for a per-token row click on `MainScreenView`), but the
 * compose step's own token picker can change it before continuing —
 * `selectedToken` local state (not the `token` prop) is what
 * `handleContinue`/the compose/review/success steps actually read from
 * this point on. `null` is always the AR path; every entry from
 * `getTokenBalances` is an AO token. Every listed token — AR or AO — is
 * genuinely sendable through this one flow; there is no disabled/"coming
 * soon" branch.
 */
export interface SendViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  token: TokenBalance | null;
  onBack: () => void;
  onDone: () => void;
}

type Step =
  | { kind: "compose"; recipient: string; amountDisplay: string; submitting: boolean; error?: string }
  | { kind: "token-picker" }
  | { kind: "recent-recipients" }
  | {
      kind: "review";
      recipient: string;
      amountAtomic: string;
      estimate: FeeEstimate;
      submitting: boolean;
      error?: string;
    }
  | { kind: "success"; txId: string; recipient: string; amountAtomic: string };

function parseArToWinston(amountAr: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(amountAr.trim())) return null;
  const [wholePart, fractionPart = ""] = amountAr.trim().split(".");
  const fraction = fractionPart.padEnd(12, "0").slice(0, 12);
  const winston = BigInt(wholePart || "0") * WINSTON_PER_AR + BigInt(fraction || "0");
  return winston.toString();
}

/**
 * Parses a human-entered display amount into an atomic-integer string in
 * `denomination`'s smallest unit (matching `TokenBalance.quantity`'s own
 * shape) — the AO-token equivalent of `parseArToWinston` above, generalized
 * over an arbitrary decimal-places `denomination` instead of AR's fixed 12.
 * `BigInt` throughout; no amount ever passes through a floating-point
 * `Number` conversion.
 */
function parseDisplayToAtomic(amountDisplay: string, denomination: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(amountDisplay.trim())) return null;
  const [wholePart, fractionPart = ""] = amountDisplay.trim().split(".");
  const fraction = fractionPart.padEnd(denomination, "0").slice(0, denomination);
  const atomic = BigInt(wholePart || "0") * 10n ** BigInt(denomination) + BigInt(fraction || "0");
  return atomic.toString();
}

/** The AO-token equivalent of `formatWinstonAsAr`, generalized over `denomination`. */
function formatAtomicAsDisplay(atomic: string, denomination: number, maxFractionDigits = 4): string {
  if (!/^\d+$/.test(atomic)) return "—";
  if (denomination === 0) return atomic;

  const unit = 10n ** BigInt(denomination);
  const amount = BigInt(atomic);
  const whole = amount / unit;
  const remainder = amount % unit;

  if (remainder === 0n) return whole.toString();

  const fractionStr = remainder.toString().padStart(denomination, "0");
  const trimmed = fractionStr.slice(0, Math.min(maxFractionDigits, denomination)).replace(/0+$/, "");

  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

function isValidArweaveAddress(address: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(address);
}

const INITIAL_STEP: Extract<Step, { kind: "compose" }> = {
  kind: "compose",
  recipient: "",
  amountDisplay: "",
  submitting: false,
};

/** `token.ticker` for an AO token, `"AR"` for the native token (`token === null`). */
function tickerFor(token: TokenBalance | null): string {
  return token?.ticker ?? "AR";
}

function formatAmount(atomic: string, token: TokenBalance | null): string {
  return token === null ? formatWinstonAsAr(atomic) : formatAtomicAsDisplay(atomic, token.denomination);
}

export function SendView({ runtime, wallet, token, onBack, onDone }: SendViewProps) {
  const [step, setStep] = useState<Step>(INITIAL_STEP);
  // The in-flow-selectable token (task 1/4: compose step's own token
  // picker can change this before continuing). Initialized from the
  // `token` prop — `App.tsx`'s entry-point context — but from here on
  // this state, not the prop, is authoritative; the prop never changes
  // identity across `SendView`'s lifetime (no `useEffect` re-sync needed).
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(token);
  // Shared cache with `MainScreenView` (`useBalances`, keyed by
  // `wallet.address`) — the compose step's client-side "insufficient
  // balance" check (RELEVANT RULES) reads this same query's current data
  // rather than issuing its own fetch.
  const balancesQuery = useBalances(runtime, wallet.address);
  // Invalidates the shared balances/activity cache for `wallet.address`
  // on success (RELEVANT RULES: both Send and Main Screen reflect the
  // updated balance without a manual popup reopen), wrapping the same
  // `submitTransfer` call this view already made directly.
  const submitTransferMutation = useSubmitTransfer(runtime, wallet.address);

  if (step.kind === "compose") {
    const handleContinue = async () => {
      const recipient = step.recipient.trim();
      if (!isValidArweaveAddress(recipient)) {
        setStep({
          ...step,
          error: "That doesn't look like a full Arweave address — check for a missing character.",
        });
        return;
      }
      const amountAtomic =
        selectedToken === null
          ? parseArToWinston(step.amountDisplay)
          : parseDisplayToAtomic(step.amountDisplay, selectedToken.denomination);
      if (amountAtomic === null || amountAtomic === "0") {
        setStep({ ...step, error: "Enter an amount greater than 0." });
        return;
      }

      const balanceError = validateSendAmount(amountAtomic, selectedToken, balancesQuery.data);
      if (balanceError !== null) {
        setStep({ ...step, error: balanceError });
        return;
      }

      setStep({ ...step, submitting: true, error: undefined });
      try {
        const estimate = await runtime.send<
          { walletId: string; recipient: string; token: string | null; amount: string; fee: null },
          FeeEstimate
        >({
          type: "estimateTransfer",
          payload: {
            walletId: wallet.id,
            recipient,
            token: selectedToken === null ? null : selectedToken.processId,
            amount: amountAtomic,
            fee: null,
          },
        });
        setStep({
          kind: "review",
          recipient,
          amountAtomic,
          estimate,
          submitting: false,
        });
      } catch (error) {
        setStep({ ...step, submitting: false, error: error instanceof Error ? error.message : String(error) });
      }
    };

    return (
      <ComposeStep
        wallet={wallet}
        token={selectedToken}
        step={step}
        onBack={onBack}
        onChange={(patch) => setStep({ ...step, ...patch, error: undefined })}
        onContinue={() => void handleContinue()}
        onOpenTokenPicker={() => setStep({ kind: "token-picker" })}
        onOpenRecentRecipients={() => setStep({ kind: "recent-recipients" })}
      />
    );
  }

  if (step.kind === "token-picker") {
    return (
      <TokenPickerStep
        balancesQuery={balancesQuery}
        selectedToken={selectedToken}
        onSelect={(nextToken) => {
          setSelectedToken(nextToken);
          setStep((prev) => (prev.kind === "token-picker" ? INITIAL_STEP : prev));
        }}
        onBack={() => setStep(INITIAL_STEP)}
      />
    );
  }

  if (step.kind === "recent-recipients") {
    return (
      <RecentRecipientsStep
        runtime={runtime}
        wallet={wallet}
        onSelect={(recipient) => setStep({ ...INITIAL_STEP, recipient })}
        onBack={() => setStep(INITIAL_STEP)}
      />
    );
  }

  if (step.kind === "review") {
    const handleSign = async () => {
      setStep({ ...step, submitting: true, error: undefined });
      try {
        const result = await submitTransferMutation.mutateAsync({
          walletId: wallet.id,
          recipient: step.recipient,
          token: selectedToken === null ? null : selectedToken.processId,
          amount: step.amountAtomic,
          fee: step.estimate.fee,
        });
        setStep({ kind: "success", txId: result.txId, recipient: step.recipient, amountAtomic: step.amountAtomic });
      } catch (error) {
        setStep({ ...step, submitting: false, error: error instanceof Error ? error.message : String(error) });
      }
    };

    return (
      <ReviewStep
        token={selectedToken}
        step={step}
        onBack={() => setStep({ ...INITIAL_STEP, recipient: step.recipient })}
        onSign={() => void handleSign()}
      />
    );
  }

  return <SuccessStep token={selectedToken} step={step} onDone={onDone} />;
}

function ComposeStep({
  wallet,
  token,
  step,
  onBack,
  onChange,
  onContinue,
  onOpenTokenPicker,
  onOpenRecentRecipients,
}: {
  wallet: WalletSummary;
  token: TokenBalance | null;
  step: Extract<Step, { kind: "compose" }>;
  onBack: () => void;
  onChange: (patch: Partial<Extract<Step, { kind: "compose" }>>) => void;
  onContinue: () => void;
  onOpenTokenPicker: () => void;
  onOpenRecentRecipients: () => void;
}) {
  const canContinue = step.recipient.trim().length > 0 && step.amountDisplay.trim().length > 0 && !step.submitting;
  const ticker = tickerFor(token);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={`Send ${ticker}`} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5">
        <div className="flex items-center justify-between text-label">
          <span className="font-semibold text-muted">From</span>
          <span className="font-semibold text-foreground">{wallet.name}</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-label font-semibold text-muted">To</span>
            <button
              type="button"
              onClick={onOpenRecentRecipients}
              className="text-label font-medium text-muted hover:text-foreground hover:underline"
            >
              Recent
            </button>
          </div>
          <textarea
            rows={2}
            value={step.recipient}
            onChange={(event) => onChange({ recipient: event.target.value })}
            placeholder="Paste an address"
            className="w-full resize-none rounded-md border border-line bg-background px-3.5 py-3 font-mono text-label leading-relaxed text-foreground focus:border-foreground focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-label font-semibold text-muted">Amount</span>
          <div className="flex items-center gap-2.5 rounded-md border border-line bg-background p-3.5 focus-within:border-foreground">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={step.amountDisplay}
              onChange={(event) => onChange({ amountDisplay: event.target.value })}
              className="min-w-0 flex-1 border-none bg-transparent text-[26px] font-semibold tracking-[-0.01em] tabular-nums text-foreground focus:outline-none"
            />
            <button
              type="button"
              onClick={onOpenTokenPicker}
              aria-haspopup="dialog"
              className="flex flex-shrink-0 items-center gap-1 rounded-full border border-line bg-mist px-2.5 py-1.5 text-label font-bold text-foreground hover:bg-line"
            >
              {ticker}
              <ChevronDownIcon />
            </button>
          </div>
        </div>

        {step.error ? (
          <div role="alert" className="flex items-start gap-1.5 text-label leading-snug text-warning">
            <span>{step.error}</span>
          </div>
        ) : null}

        <Button type="button" disabled={!canContinue} aria-busy={step.submitting} onClick={onContinue} className="mt-auto">
          {step.submitting ? "Checking…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReviewStep({
  token,
  step,
  onBack,
  onSign,
}: {
  token: TokenBalance | null;
  step: Extract<Step, { kind: "review" }>;
  onBack: () => void;
  onSign: () => void;
}) {
  const ticker = tickerFor(token);
  // AO transfers have no sender-side fee quote — `estimate.fee` is `null`
  // for that path (see `core/ao/transfer.ts`'s `AO_TRANSFER_HAS_NO_FEE` doc
  // comment). The total then equals the send amount itself, and the Fee row
  // says so explicitly rather than showing a fabricated "0 <TICKER>".
  const total =
    step.estimate.fee === null
      ? step.amountAtomic
      : (BigInt(step.amountAtomic) + BigInt(step.estimate.fee)).toString();
  const irreversible = step.estimate.firstSeenRecipient;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Review send" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5">
        <div className="flex flex-col items-center gap-1 pb-1 pt-2 text-center">
          <span className="text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {formatAmount(step.amountAtomic, token)} {ticker}
          </span>
        </div>

        {irreversible ? (
          <RiskNotice>
            <strong className="font-bold">You haven&apos;t sent to this address before.</strong> Double-check
            it&apos;s correct — this can&apos;t be undone once signed.
          </RiskNotice>
        ) : (
          <p className="text-label leading-relaxed text-muted">
            You&apos;re sending {formatAmount(step.amountAtomic, token)} {ticker} to this address. This can&apos;t
            be undone.
          </p>
        )}

        <div className="flex flex-col">
          <ReviewRow label="Recipient" value={step.recipient} mono />
          <ReviewRow
            label="Fee"
            value={step.estimate.fee === null ? "No network fee" : `${formatWinstonAsAr(step.estimate.fee)} AR`}
          />
          <ReviewRow label="Total" value={`${formatAmount(total, token)} ${ticker}`} strong />
        </div>

        {step.error ? (
          <div role="alert" className="text-label leading-snug text-warning">
            {step.error}
          </div>
        ) : null}

        <Button
          type="button"
          variant={irreversible ? "destructive" : "primary"}
          disabled={step.submitting}
          aria-busy={step.submitting}
          onClick={onSign}
          className="mt-auto"
        >
          {step.submitting ? "Signing…" : "Sign and send"}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-label last:border-b-0 last:border-t last:pt-3">
      <span className="text-muted">{label}</span>
      <span
        className={`text-right tabular-nums text-foreground ${strong ? "font-bold" : "font-semibold"} ${mono ? "max-w-[220px] break-all font-mono text-[11px] font-medium" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Task 1: token picker — a pushed screen (`WalletSwitcherView.tsx`'s
 * established "ScreenHeader + rows" pattern, not a dropdown/modal — none
 * exists in this project). AR is a synthetic first row (`token: null`);
 * every other row comes from `getTokenBalances`, reusing `TokenRow`
 * exactly as `MainScreenView` does. Every row is genuinely selectable —
 * there is no disabled/"coming soon" state, per RELEVANT RULES.
 */
function TokenPickerStep({
  balancesQuery,
  selectedToken,
  onSelect,
  onBack,
}: {
  balancesQuery: UseQueryResult<WalletBalances>;
  selectedToken: TokenBalance | null;
  onSelect: (token: TokenBalance | null) => void;
  onBack: () => void;
}) {
  const loading = balancesQuery.isLoading;
  const errorMessage = balancesQuery.error
    ? balancesQuery.error instanceof Error
      ? balancesQuery.error.message
      : String(balancesQuery.error)
    : null;

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Select token">
      <ScreenHeader title="Select token" onBack={onBack} />
      <div className="flex flex-1 flex-col px-1 py-2">
        {errorMessage ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning">
            {errorMessage}
          </div>
        ) : null}

        <TokenRow
          glyph={{ label: "AR", tone: 1 }}
          name="Arweave"
          ticker="AR"
          amount={balancesQuery.data === undefined ? "" : formatWinstonAsAr(balancesQuery.data.arBalance)}
          loading={loading}
          onClick={() => onSelect(null)}
          className={selectedToken === null ? "bg-mist" : undefined}
        />

        {loading ? (
          <>
            <SkeletonPickerRow />
            <SkeletonPickerRow />
          </>
        ) : (
          (balancesQuery.data?.tokenBalances ?? []).map((candidate) => (
            <TokenRow
              key={candidate.processId}
              glyph={{ label: candidate.ticker.slice(0, 2).toUpperCase(), tone: 2 }}
              name={candidate.ticker}
              ticker={candidate.ticker}
              amount={formatAtomicAsDisplay(candidate.quantity, candidate.denomination)}
              onClick={() => onSelect(candidate)}
              className={selectedToken?.processId === candidate.processId ? "bg-mist" : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SkeletonPickerRow() {
  return (
    <div className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 last:border-b-0">
      <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-mist" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3 w-20 animate-pulse rounded bg-mist" />
        <div className="h-2.5 w-10 animate-pulse rounded bg-mist" />
      </div>
    </div>
  );
}

/**
 * Task 2: recent-recipients picker — derived live, in-process, every time
 * this step mounts, from `getActivity`'s merged `ActivityPage` (RELEVANT
 * RULES: no new storage/`ProtocolMap` method). Filters to `type: 'send'`
 * entries, maps to `address`, dedupes (first occurrence wins — entries
 * already arrive most-recent-first from `mergeActivity`), and renders the
 * distinct addresses in that same most-recent-first order. Truncated
 * display here only (per RELEVANT RULES); the full address is what gets
 * passed to `onSelect`.
 */
function RecentRecipientsStep({
  runtime,
  wallet,
  onSelect,
  onBack,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onSelect: (recipient: string) => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<{ recipients: string[]; loading: boolean; error: string | null }>({
    recipients: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const activity = await runtime.send<{ address: string }, ActivityPage>({
        type: "getActivity",
        payload: { address: wallet.address },
      });
      setState({ recipients: recentSendRecipients(activity), loading: false, error: null });
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

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Recent recipients">
      <ScreenHeader title="Recent recipients" onBack={onBack} />
      <div className="flex flex-1 flex-col px-1 py-2">
        {state.error ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning">
            {state.error}
          </div>
        ) : state.loading ? (
          <>
            <SkeletonPickerRow />
            <SkeletonPickerRow />
          </>
        ) : state.recipients.length === 0 ? (
          <EmptyState message="No recent recipients yet. Addresses you've sent to will show up here." />
        ) : (
          state.recipients.map((address) => (
            <button
              key={address}
              type="button"
              onClick={() => onSelect(address)}
              className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left last:border-b-0 hover:bg-mist"
            >
              <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-mist text-caption font-semibold text-muted">
                {address.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">
                {truncateAddress(address)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Pure extraction — separated from `RecentRecipientsStep` so it's testable
 * without mounting the component. `mergeActivity` (`core/activity/merge.ts`)
 * already returns entries most-recent-first (its own doc contract), so
 * this only needs to filter/map/dedupe, not re-sort — but sorts
 * defensively by `timestamp` descending anyway rather than assuming the
 * caller's ordering contract silently holds forever.
 */
function recentSendRecipients(activity: ActivityPage): string[] {
  const sendEntries = activity.entries
    .filter((entry) => entry.type === "send")
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);

  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const entry of sendEntries) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    recipients.push(entry.address);
  }
  return recipients;
}

function SuccessStep({
  token,
  step,
  onDone,
}: {
  token: TokenBalance | null;
  step: Extract<Step, { kind: "success" }>;
  onDone: () => void;
}) {
  const ticker = tickerFor(token);
  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-6 pb-6 pt-12 text-center">
      <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-mist text-foreground">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-body text-foreground">Signed and sent.</h2>
      <p className="-mt-2 text-label text-muted">
        {formatAmount(step.amountAtomic, token)} {ticker} to {step.recipient}
      </p>
      <div className="mt-2 flex w-full items-center gap-2 border-b border-line py-3 text-label text-muted">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-beam-yellow" />
        <span>Pending confirmation</span>
      </div>
      <Button type="button" onClick={onDone} className="mt-auto">
        Done
      </Button>
    </div>
  );
}
