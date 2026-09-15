import { useState } from "react";
import type { FeeEstimate, RuntimePort, TokenBalance, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { formatWinstonAsAr } from "../../main-screen/src/formatWinston";

const WINSTON_PER_AR = 1_000_000_000_000n;

/**
 * Send flow (send-flow.html / TODO.md §2) — compose → review → success,
 * internal step state only (same "no router" pattern as
 * Onboarding/UnlockView). `ComposeStep`/`ReviewStep`/`SuccessStep` below
 * are pure render helpers, not independently-mounted steps, matching how
 * `OnboardingView` structures its own switch.
 *
 * No password prompt here: `estimateTransfer`/`submitTransfer` read the
 * signing key from the background's in-memory unlocked-session cache
 * (`apps/extension/src/handlers/key-session.ts`), not from this request —
 * see that file's doc comment. `App.tsx`'s `resolveTopView` already keeps
 * an unauthenticated user on the unlock screen, so `SendView` only ever
 * mounts once a wallet is unlocked.
 *
 * `token` (added by AO-TOKEN-SEND-WALLET-CORE): `null` is the pre-existing
 * AR path (`App.tsx`'s top-level "Send" action, unchanged behavior); a
 * `TokenBalance` is an AO token, entered by clicking that token's row on
 * `MainScreenView`. Every listed token — AR or AO — is genuinely sendable
 * through this one flow; there is no disabled/"coming soon" branch.
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

const INITIAL_STEP: Step = { kind: "compose", recipient: "", amountDisplay: "", submitting: false };

/** `token.ticker` for an AO token, `"AR"` for the native token (`token === null`). */
function tickerFor(token: TokenBalance | null): string {
  return token?.ticker ?? "AR";
}

function formatAmount(atomic: string, token: TokenBalance | null): string {
  return token === null ? formatWinstonAsAr(atomic) : formatAtomicAsDisplay(atomic, token.denomination);
}

export function SendView({ runtime, wallet, token, onBack, onDone }: SendViewProps) {
  const [step, setStep] = useState<Step>(INITIAL_STEP);

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
        token === null
          ? parseArToWinston(step.amountDisplay)
          : parseDisplayToAtomic(step.amountDisplay, token.denomination);
      if (amountAtomic === null || amountAtomic === "0") {
        setStep({ ...step, error: "Enter an amount greater than 0." });
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
            token: token === null ? null : token.processId,
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
        token={token}
        step={step}
        onBack={onBack}
        onChange={(patch) => setStep({ ...step, ...patch, error: undefined })}
        onContinue={() => void handleContinue()}
      />
    );
  }

  if (step.kind === "review") {
    const handleSign = async () => {
      setStep({ ...step, submitting: true, error: undefined });
      try {
        const result = await runtime.send<
          { walletId: string; recipient: string; token: string | null; amount: string; fee: string | null },
          { txId: string }
        >({
          type: "submitTransfer",
          payload: {
            walletId: wallet.id,
            recipient: step.recipient,
            token: token === null ? null : token.processId,
            amount: step.amountAtomic,
            fee: step.estimate.fee,
          },
        });
        setStep({ kind: "success", txId: result.txId, recipient: step.recipient, amountAtomic: step.amountAtomic });
      } catch (error) {
        setStep({ ...step, submitting: false, error: error instanceof Error ? error.message : String(error) });
      }
    };

    return (
      <ReviewStep
        token={token}
        step={step}
        onBack={() => setStep({ ...INITIAL_STEP, recipient: step.recipient })}
        onSign={() => void handleSign()}
      />
    );
  }

  return <SuccessStep token={token} step={step} onDone={onDone} />;
}

function ComposeStep({
  wallet,
  token,
  step,
  onBack,
  onChange,
  onContinue,
}: {
  wallet: WalletSummary;
  token: TokenBalance | null;
  step: Extract<Step, { kind: "compose" }>;
  onBack: () => void;
  onChange: (patch: Partial<Extract<Step, { kind: "compose" }>>) => void;
  onContinue: () => void;
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
          <span className="text-label font-semibold text-muted">To</span>
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
            <span className="flex-shrink-0 rounded-full border border-line bg-mist px-2.5 py-1.5 text-label font-bold text-foreground">
              {ticker}
            </span>
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
