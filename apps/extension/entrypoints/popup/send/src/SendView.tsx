import { useState } from "react";
import type { FeeEstimate, RuntimePort, WalletSummary } from "@gleam/core";
import { PasswordField, ScreenHeader } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { formatWinstonAsAr } from "../../main-screen/src/formatWinston";

const WINSTON_PER_AR = 1_000_000_000_000n;

/**
 * Send flow (send-flow.html / TODO.md §2) — compose → review → success,
 * internal step state only (same "no router" pattern as
 * Onboarding/UnlockView). `ComposeStep`/`ReviewStep`/`SuccessStep` below
 * are pure render helpers, not independently-mounted steps, matching how
 * `OnboardingView` structures its own switch.
 *
 * Password prompt on the compose step: see `handlers/transfer.ts`'s doc
 * comment for why `estimateTransfer`/`submitTransfer` need a password
 * alongside the `TransferDraft` fields `ProtocolMap` declares. This view
 * collects it once, on Continue, and carries it forward in `step` state
 * (never in a module-level variable) through to the final `submitTransfer`
 * call — it's discarded the moment `SendView` unmounts, same as every
 * other password field in this codebase (`UnlockScreen`, onboarding's
 * `CreatePassword`).
 */
export interface SendViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
  onDone: () => void;
}

type Step =
  | { kind: "compose"; recipient: string; amountAr: string; password: string; submitting: boolean; error?: string }
  | {
      kind: "review";
      recipient: string;
      amountWinston: string;
      estimate: FeeEstimate;
      password: string;
      submitting: boolean;
      error?: string;
    }
  | { kind: "success"; txId: string; recipient: string; amountWinston: string };

function parseArToWinston(amountAr: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(amountAr.trim())) return null;
  const [wholePart, fractionPart = ""] = amountAr.trim().split(".");
  const fraction = fractionPart.padEnd(12, "0").slice(0, 12);
  const winston = BigInt(wholePart || "0") * WINSTON_PER_AR + BigInt(fraction || "0");
  return winston.toString();
}

function isValidArweaveAddress(address: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(address);
}

const INITIAL_STEP: Step = { kind: "compose", recipient: "", amountAr: "", password: "", submitting: false };

export function SendView({ runtime, wallet, onBack, onDone }: SendViewProps) {
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
      const amountWinston = parseArToWinston(step.amountAr);
      if (amountWinston === null || amountWinston === "0") {
        setStep({ ...step, error: "Enter an amount greater than 0." });
        return;
      }

      setStep({ ...step, submitting: true, error: undefined });
      try {
        const estimate = await runtime.send<
          { walletId: string; password: string; recipient: string; token: null; amount: string; fee: null },
          FeeEstimate
        >({
          type: "estimateTransfer",
          payload: {
            walletId: wallet.id,
            password: step.password,
            recipient,
            token: null,
            amount: amountWinston,
            fee: null,
          },
        });
        setStep({
          kind: "review",
          recipient,
          amountWinston,
          estimate,
          password: step.password,
          submitting: false,
        });
      } catch (error) {
        setStep({ ...step, submitting: false, error: error instanceof Error ? error.message : String(error) });
      }
    };

    return (
      <ComposeStep
        wallet={wallet}
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
          { walletId: string; password: string; recipient: string; token: null; amount: string; fee: string | null },
          { txId: string }
        >({
          type: "submitTransfer",
          payload: {
            walletId: wallet.id,
            password: step.password,
            recipient: step.recipient,
            token: null,
            amount: step.amountWinston,
            fee: step.estimate.fee,
          },
        });
        setStep({ kind: "success", txId: result.txId, recipient: step.recipient, amountWinston: step.amountWinston });
      } catch (error) {
        setStep({ ...step, submitting: false, error: error instanceof Error ? error.message : String(error) });
      }
    };

    return (
      <ReviewStep
        step={step}
        onBack={() => setStep({ ...INITIAL_STEP, recipient: step.recipient })}
        onSign={() => void handleSign()}
      />
    );
  }

  return <SuccessStep step={step} onDone={onDone} />;
}

function ComposeStep({
  wallet,
  step,
  onBack,
  onChange,
  onContinue,
}: {
  wallet: WalletSummary;
  step: Extract<Step, { kind: "compose" }>;
  onBack: () => void;
  onChange: (patch: Partial<Extract<Step, { kind: "compose" }>>) => void;
  onContinue: () => void;
}) {
  const canContinue =
    step.recipient.trim().length > 0 &&
    step.amountAr.trim().length > 0 &&
    step.password.length > 0 &&
    !step.submitting;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Send" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[#737373]">From</span>
          <span className="font-semibold text-[#111111]">{wallet.name}</span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-[#737373]">To</span>
          <textarea
            rows={2}
            value={step.recipient}
            onChange={(event) => onChange({ recipient: event.target.value })}
            placeholder="Paste an address"
            className="w-full resize-none rounded-[9px] border border-[#e5e5e5] bg-white px-3.5 py-3 font-mono text-[13px] leading-relaxed text-[#111111] focus:border-[#111111] focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-[#737373]">Amount</span>
          <div className="flex items-center gap-2.5 rounded-[9px] border border-[#e5e5e5] bg-white p-3.5 focus-within:border-[#111111]">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={step.amountAr}
              onChange={(event) => onChange({ amountAr: event.target.value })}
              className="min-w-0 flex-1 border-none bg-transparent text-[26px] font-semibold tracking-[-0.01em] tabular-nums text-[#111111] focus:outline-none"
            />
            <span className="flex-shrink-0 rounded-full border border-[#e5e5e5] bg-[#f5f5f5] px-2.5 py-1.5 text-[13px] font-bold text-[#111111]">
              AR
            </span>
          </div>
        </div>

        <PasswordField
          label="Password"
          placeholder="Enter your password to continue"
          autoComplete="current-password"
          value={step.password}
          onChange={(event) => onChange({ password: event.target.value })}
        />

        {step.error ? (
          <div role="alert" className="flex items-start gap-1.5 text-xs leading-snug text-[#ff1717]">
            <span>{step.error}</span>
          </div>
        ) : null}

        <Button
          type="button"
          disabled={!canContinue}
          aria-busy={step.submitting}
          onClick={onContinue}
          className="mt-auto w-full rounded-[10px] py-3"
        >
          {step.submitting ? "Checking…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({
  step,
  onBack,
  onSign,
}: {
  step: Extract<Step, { kind: "review" }>;
  onBack: () => void;
  onSign: () => void;
}) {
  const total = (BigInt(step.amountWinston) + BigInt(step.estimate.fee)).toString();
  const irreversible = step.estimate.firstSeenRecipient;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Review send" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5">
        <div className="flex flex-col items-center gap-1 pb-1 pt-2 text-center">
          <span className="text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-[#111111]">
            {formatWinstonAsAr(step.amountWinston)} AR
          </span>
        </div>

        {irreversible ? (
          <div className="flex gap-2.5 rounded-[9px] border border-[#ffd6d6] bg-[#fff5f5] p-3.5">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="mt-px flex-shrink-0 text-[#ff1717]"
            >
              <path
                d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-xs leading-relaxed text-[#111111]">
              <strong className="font-bold">You haven&apos;t sent to this address before.</strong> Double-check
              it&apos;s correct — this can&apos;t be undone once signed.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-[#737373]">
            You&apos;re sending {formatWinstonAsAr(step.amountWinston)} AR to this address. This can&apos;t be
            undone.
          </p>
        )}

        <div className="flex flex-col">
          <ReviewRow label="Recipient" value={step.recipient} mono />
          <ReviewRow label="Fee" value={`${formatWinstonAsAr(step.estimate.fee)} AR`} />
          <ReviewRow label="Total" value={`${formatWinstonAsAr(total)} AR`} strong />
        </div>

        {step.error ? (
          <div role="alert" className="text-xs leading-snug text-[#ff1717]">
            {step.error}
          </div>
        ) : null}

        <Button
          type="button"
          disabled={step.submitting}
          aria-busy={step.submitting}
          onClick={onSign}
          className={`mt-auto w-full rounded-[10px] py-3 ${irreversible ? "bg-[#ff1717] hover:bg-[#ff1717]" : ""}`}
        >
          {step.submitting ? "Signing…" : "Sign and send"}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#e5e5e5] py-2.5 text-[13px] last:border-b-0 last:border-t last:pt-3">
      <span className="text-[#737373]">{label}</span>
      <span
        className={`text-right tabular-nums text-[#111111] ${strong ? "font-bold" : "font-semibold"} ${mono ? "max-w-[220px] break-all font-mono text-[11px] font-medium" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function SuccessStep({ step, onDone }: { step: Extract<Step, { kind: "success" }>; onDone: () => void }) {
  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-6 pb-6 pt-12 text-center">
      <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#f5f5f5] text-[#111111]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-base text-[#111111]">Signed and sent.</h2>
      <p className="-mt-2 text-[13px] text-[#737373]">
        {formatWinstonAsAr(step.amountWinston)} AR to {step.recipient}
      </p>
      <div className="mt-2 flex w-full items-center gap-2 border-b border-[#e5e5e5] py-3 text-xs text-[#737373]">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FFE45C]" />
        <span>Pending confirmation</span>
      </div>
      <Button type="button" onClick={onDone} className="mt-auto w-full rounded-[10px] py-3">
        Done
      </Button>
    </div>
  );
}
