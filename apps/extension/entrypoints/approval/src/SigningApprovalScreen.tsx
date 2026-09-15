import { useState } from "react";
import type { SigningApprovalPreview } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";

/**
 * Ports `signing-approval.html` (6.2) exactly — "the highest-stakes
 * screen in the product" per this task's packet: recipient, amount, fee,
 * a decoded-data preview, tags, and a SHA-256 hash of the exact signing
 * payload with its own copy affordance, all shown before signing is
 * possible. Full addresses only, never truncated (`.value-mono`'s
 * `break-all`, matching the mockup, not `AddressDisplay`'s truncated
 * variant). Never uses the beam as anything but the small identity mark,
 * never uses humor here — this is the one screen the packet's RELEVANT
 * RULES singles out for "maximum clarity, zero cleverness." The
 * irreversible-tier `RiskNotice`/`destructive` Button pairing is the same
 * one `RiskNotice`'s own doc comment names as this screen's reason for
 * existing as a single shared component.
 */
export interface SigningApprovalScreenProps {
  origin: string;
  preview: SigningApprovalPreview;
  onReject: () => void;
  /** Rejects (surfacing its message inline) if signing fails — e.g. the wallet's unlocked session has since expired. */
  onSign: () => Promise<void>;
}

const REQUEST_KIND_COPY: Record<SigningApprovalPreview["kind"], string> = {
  sign: "Sign and send",
  dispatch: "Sign and send",
  signDataItem: "Sign message",
  batchSignDataItem: "Sign messages",
  encrypt: "Encrypt data",
  decrypt: "Decrypt data",
};

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard access can be denied by the browser — the value is still
    // fully visible and selectable on screen, so this is a soft failure.
  }
}

export function SigningApprovalScreen({ origin, preview, onReject, onSign }: SigningApprovalScreenProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const isTransfer = preview.recipient !== null;
  const irreversible = isTransfer; // first-seen/unlimited tiering happens upstream in the dispatcher's preview construction.

  const handleSign = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onSign();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md border border-line bg-mist text-[10px] font-bold text-muted">
          {hostnameOf(origin).charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-caption font-semibold text-foreground">{hostnameOf(origin)}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4.5">
        <div className="text-center text-body font-bold text-foreground">{REQUEST_KIND_COPY[preview.kind]}</div>

        {isTransfer ? (
          <>
            <div className="flex flex-col items-center gap-1 py-1 text-center">
              <span className="text-[28px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
                {preview.amount ?? "—"}
              </span>
            </div>

            {irreversible ? (
              <RiskNotice>
                <strong className="font-bold">This can&apos;t be undone.</strong> Double-check the recipient
                before signing.
              </RiskNotice>
            ) : null}

            <AddrBlock label="Recipient" value={preview.recipient ?? ""} />

            <div className="flex flex-col">
              <ReviewRow label="Fee" value={preview.fee ?? "—"} />
              <ReviewRow label="Total" value={preview.amount ?? "—"} strong />
            </div>
          </>
        ) : null}

        {preview.decodedData !== null ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold uppercase tracking-wide text-muted">Decoded data</span>
            <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-mist p-3 font-mono text-caption leading-relaxed text-foreground">
              {preview.decodedData}
            </div>
          </div>
        ) : null}

        {preview.tags.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold uppercase tracking-wide text-muted">Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {preview.tags.map((tag, index) => (
                <span key={index} className="rounded-md bg-mist px-2 py-1 font-mono text-[10px] text-foreground">
                  <span className="text-muted">{tag.name}:</span> {tag.value}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <AddrBlock label="Signing payload (SHA-256)" value={preview.payloadHash} />

        {error ? (
          <div role="alert" className="text-caption leading-snug text-warning">
            {error}
          </div>
        ) : null}

        <div className="mt-auto flex gap-2.5 pt-1">
          <Button type="button" variant="secondary" onClick={onReject} className="flex-1">
            Reject
          </Button>
          <Button
            type="button"
            variant={irreversible ? "destructive" : "primary"}
            disabled={submitting}
            aria-busy={submitting}
            onClick={() => void handleSign()}
            className="flex-1"
          >
            {submitting ? "Signing…" : REQUEST_KIND_COPY[preview.kind]}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddrBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-line bg-background p-3">
        <span className="flex-1 break-all font-mono text-caption leading-relaxed text-foreground">{value}</span>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void copyToClipboard(value)}
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-muted"
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-label last:border-b-0 last:border-t last:pt-3">
      <span className="text-muted">{label}</span>
      <span className={`text-right tabular-nums text-foreground ${strong ? "font-bold" : "font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
