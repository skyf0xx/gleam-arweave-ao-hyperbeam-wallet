import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ActivityPage, FeeEstimate, RuntimePort, TokenBalance, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { EmptyState, TokenRow } from "@gleam/ui/src/components/wallet/index.ts";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
import { formatWinstonAsAr, truncateAddress } from "../../main-screen/src/formatWinston";
import { useActivity } from "../../activity/src/useActivity";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { useSubmitTransfer } from "../../activity/src/useSubmitTransfer";
import { validateSendAmount } from "../../activity/src/validateSendAmount";
import { amountSchema, firstIssueMessage, recipientSchema } from "./sendFormSchema";

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
  | {
      kind: "compose";
      recipient: string;
      amountDisplay: string;
      submitting: boolean;
      recipientError?: string;
      amountError?: string;
    }
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

/**
 * Strips the amount input to digits and at most one decimal point as the
 * user types — commas, letters, and extra `.`s never land in the field,
 * rather than being accepted and only rejected later by `amountSchema` on
 * Continue.
 */
function sanitizeAmountInput(raw: string): string {
  const digitsAndDots = raw.replace(/[^0-9.]/g, "");
  const firstDot = digitsAndDots.indexOf(".");
  if (firstDot === -1) return digitsAndDots;
  return digitsAndDots.slice(0, firstDot + 1) + digitsAndDots.slice(firstDot + 1).replace(/\./g, "");
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

/**
 * A `ticker` that is really an Arweave/AO process id (unregistered
 * tokens have no other source for a symbol — see `ao/balance.ts`)
 * shortens to a `abcd…wxyz` display form rather than showing the full
 * 43-char address as if it were the token's name.
 */
function displayTicker(ticker: string): string {
  return isValidArweaveAddress(ticker) ? `${ticker.slice(0, 4)}…${ticker.slice(-4)}` : ticker;
}

/** `token.ticker` for an AO token, `"AR"` for the native token (`token === null`). */
function tickerFor(token: TokenBalance | null): string {
  return token === null ? "AR" : displayTicker(token.ticker);
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
      const recipientResult = recipientSchema.safeParse(step.recipient);
      if (!recipientResult.success) {
        setStep({
          ...step,
          recipientError: firstIssueMessage(recipientResult.error, "That doesn't look like a valid address."),
          amountError: undefined,
        });
        return;
      }
      const recipient = recipientResult.data;

      const denomination = selectedToken === null ? 12 : selectedToken.denomination;
      const amountResult = amountSchema(denomination).safeParse(step.amountDisplay);
      if (!amountResult.success) {
        setStep({
          ...step,
          recipientError: undefined,
          amountError: firstIssueMessage(amountResult.error, "Enter a valid amount."),
        });
        return;
      }
      const amountAtomic =
        selectedToken === null
          ? parseArToWinston(amountResult.data)
          : parseDisplayToAtomic(amountResult.data, selectedToken.denomination);
      if (amountAtomic === null) {
        setStep({ ...step, recipientError: undefined, amountError: "Enter a valid amount." });
        return;
      }

      const balanceError = validateSendAmount(amountAtomic, selectedToken, balancesQuery.data);
      if (balanceError !== null) {
        setStep({ ...step, recipientError: undefined, amountError: balanceError });
        return;
      }

      setStep({ ...step, submitting: true, recipientError: undefined, amountError: undefined });
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
        setStep({
          ...step,
          submitting: false,
          amountError: error instanceof Error ? error.message : String(error),
        });
      }
    };

    return (
      <ComposeStep
        wallet={wallet}
        token={selectedToken}
        balancesQuery={balancesQuery}
        step={step}
        onBack={onBack}
        onChange={(patch) =>
          setStep({
            ...step,
            ...patch,
            recipientError: "recipient" in patch ? undefined : step.recipientError,
            amountError: "amountDisplay" in patch ? undefined : step.amountError,
          })
        }
        onBlurRecipient={() => {
          if (step.recipient.trim().length === 0) return;
          const result = recipientSchema.safeParse(step.recipient);
          setStep({
            ...step,
            recipientError: result.success
              ? undefined
              : firstIssueMessage(result.error, "That doesn't look like a valid address."),
          });
        }}
        onBlurAmount={() => {
          if (step.amountDisplay.trim().length === 0) return;
          const denomination = selectedToken === null ? 12 : selectedToken.denomination;
          const result = amountSchema(denomination).safeParse(step.amountDisplay);
          setStep({
            ...step,
            amountError: result.success ? undefined : firstIssueMessage(result.error, "Enter a valid amount."),
          });
        }}
        onContinue={() => void handleContinue()}
        onOpenTokenPicker={() => setStep({ kind: "token-picker" })}
        onOpenRecentRecipients={() => setStep({ kind: "recent-recipients" })}
      />
    );
  }

  if (step.kind === "token-picker") {
    return (
      <TokenPickerStep
        walletAddress={wallet.address}
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
  balancesQuery,
  step,
  onBack,
  onChange,
  onBlurRecipient,
  onBlurAmount,
  onContinue,
  onOpenTokenPicker,
  onOpenRecentRecipients,
}: {
  wallet: WalletSummary;
  token: TokenBalance | null;
  balancesQuery: UseQueryResult<WalletBalances>;
  step: Extract<Step, { kind: "compose" }>;
  onBack: () => void;
  onChange: (patch: Partial<Extract<Step, { kind: "compose" }>>) => void;
  onBlurRecipient: () => void;
  onBlurAmount: () => void;
  onContinue: () => void;
  onOpenTokenPicker: () => void;
  onOpenRecentRecipients: () => void;
}) {
  const denomination = token === null ? 12 : token.denomination;
  const canContinue =
    !step.submitting &&
    recipientSchema.safeParse(step.recipient).success &&
    amountSchema(denomination).safeParse(step.amountDisplay).success;
  const ticker = tickerFor(token);
  // "Max" affordance next to the amount field: the current token's spendable
  // balance, formatted the same way the compose/review amounts already are.
  // `undefined` while `balancesQuery` hasn't resolved yet — the pill hides
  // rather than showing a stale/zero balance a click could act on.
  const maxAtomic =
    token === null
      ? balancesQuery.data?.arBalance
      : balancesQuery.data?.tokenBalances.find((candidate) => candidate.processId === token.processId)?.quantity;
  const maxDisplay = maxAtomic === undefined ? undefined : formatAtomicAsDisplay(maxAtomic, denomination);

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
            onBlur={onBlurRecipient}
            placeholder="Paste an address"
            className="w-full resize-none rounded-md border border-line bg-background px-3.5 py-3 font-mono text-label leading-relaxed text-foreground focus:border-foreground focus:outline-none"
          />
          {step.recipientError ? (
            <div role="alert" className="text-label leading-snug text-warning">
              {step.recipientError}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-label font-semibold text-muted">Amount</span>
            {maxDisplay !== undefined ? (
              <button
                type="button"
                onClick={() => onChange({ amountDisplay: maxDisplay })}
                className="text-label font-medium text-muted hover:text-foreground hover:underline"
              >
                Max: {maxDisplay}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2.5 rounded-md border border-line bg-background p-3.5 focus-within:border-foreground">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={step.amountDisplay}
              onChange={(event) => onChange({ amountDisplay: sanitizeAmountInput(event.target.value) })}
              onBlur={onBlurAmount}
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
          {step.amountError ? (
            <div role="alert" className="text-label leading-snug text-warning">
              {step.amountError}
            </div>
          ) : null}
        </div>

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
            it&apos;s correct. This can&apos;t be undone once signed.
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
 * Synthetic `TokenBalance` for the AO default row when `balancesQuery.data`
 * has no matching AO entry yet (unloaded, or a wallet that genuinely holds
 * none). Gives the row a real, selectable `token: null`-equivalent — every
 * row here must stay clickable (RELEVANT RULES), so a `div`-only "coming
 * soon" row (what `TokenRow` renders when `onClick` is `undefined`) isn't an
 * option. `address` mirrors the connected wallet since nothing downstream of
 * `selectedToken` reads anything but `processId`/`ticker`/`denomination`/
 * `quantity` (see `handleContinue`/`handleSign` above).
 */
function defaultAoTokenBalance(walletAddress: string): TokenBalance {
  return {
    address: walletAddress,
    processId: DEFAULT_AO_TOKEN.processId as string,
    ticker: DEFAULT_AO_TOKEN.ticker,
    denomination: 0,
    quantity: "0",
  };
}

/**
 * Task 1: token picker — a pushed screen (`WalletSwitcherView.tsx`'s
 * established "ScreenHeader + rows" pattern, not a dropdown/modal — none
 * exists in this project). AR and AO are synthetic default rows (mirroring
 * `MainScreenView`'s Tokens tab — see `buildDefaultTokenRows`/
 * `nonDefaultTokenBalances` there): AR is `token: null`, and AO is always
 * rendered above any other watched AO tokens, falling back to
 * `DEFAULT_AR_TOKEN`/`DEFAULT_AO_TOKEN`'s `"0"` `defaultDisplayAmount`
 * while `balancesQuery.data` is unloaded or has no AO entry, and updating to
 * the real balance once it resolves. Every row is genuinely selectable —
 * there is no disabled/"coming soon" state, per RELEVANT RULES.
 */
function TokenPickerStep({
  walletAddress,
  balancesQuery,
  selectedToken,
  onSelect,
  onBack,
}: {
  walletAddress: string;
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

  const aoBalance = balancesQuery.data?.tokenBalances.find(
    (candidate) => candidate.processId === DEFAULT_AO_TOKEN.processId,
  );
  const aoToken = aoBalance ?? defaultAoTokenBalance(walletAddress);
  const otherTokenBalances = (balancesQuery.data?.tokenBalances ?? []).filter(
    (candidate) => candidate.processId !== DEFAULT_AO_TOKEN.processId,
  );

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
          glyph={{ label: DEFAULT_AR_TOKEN.ticker, tone: 1 }}
          name={DEFAULT_AR_TOKEN.name}
          amount={
            balancesQuery.data === undefined
              ? DEFAULT_AR_TOKEN.defaultDisplayAmount
              : formatWinstonAsAr(balancesQuery.data.arBalance)
          }
          loading={loading}
          onClick={() => onSelect(null)}
          className={selectedToken === null ? "bg-mist" : undefined}
        />

        <TokenRow
          glyph={{ label: DEFAULT_AO_TOKEN.ticker, tone: 2 }}
          name={DEFAULT_AO_TOKEN.name}
          amount={aoBalance ? formatAtomicAsDisplay(aoBalance.quantity, aoBalance.denomination) : DEFAULT_AO_TOKEN.defaultDisplayAmount}
          loading={loading}
          onClick={() => onSelect(aoToken)}
          className={selectedToken?.processId === DEFAULT_AO_TOKEN.processId ? "bg-mist" : undefined}
        />

        {loading ? (
          <>
            <SkeletonPickerRow />
            <SkeletonPickerRow />
          </>
        ) : (
          otherTokenBalances.map((candidate) => (
            <TokenRow
              key={candidate.processId}
              glyph={{ label: displayTicker(candidate.ticker).slice(0, 2).toUpperCase(), tone: 2 }}
              name={displayTicker(candidate.ticker)}
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
 * Task 2: recent-recipients picker — derived from the shared `useActivity`
 * cache (`wallet.address`-keyed, same query `MainScreenView` and this
 * view's own review step read) rather than this step's own independent
 * `getActivity` fetch. `useActivity` was already built for exactly this
 * (see its own doc comment), but this step had kept a local
 * `useState`/`useEffect` fetch that duplicated it and raced its own
 * request against `MainScreenView`'s — this closes that gap so mounting
 * this step reuses whatever's already cached (or shares the one in-flight
 * request) instead of issuing a second one. Filters to `type: 'send'`
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
  const activityQuery = useActivity(runtime, wallet.address);
  const recipients = activityQuery.data ? recentSendRecipients(activityQuery.data) : [];

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Recent recipients">
      <ScreenHeader title="Recent recipients" onBack={onBack} />
      <div className="flex flex-1 flex-col px-1 py-2">
        {activityQuery.isError ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning">
            {activityQuery.error instanceof Error ? activityQuery.error.message : String(activityQuery.error)}
          </div>
        ) : activityQuery.isLoading ? (
          <>
            <SkeletonPickerRow />
            <SkeletonPickerRow />
          </>
        ) : recipients.length === 0 ? (
          <EmptyState message="No recent recipients yet. Addresses you've sent to will show up here." />
        ) : (
          recipients.map((address) => (
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
