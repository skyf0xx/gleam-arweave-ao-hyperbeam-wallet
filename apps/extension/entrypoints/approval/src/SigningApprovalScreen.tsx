import { useState } from "react";
import type { SigningApprovalPreview } from "@gleam/core";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * Ports `signing-approval.html` (6.2) exactly — "the highest-stakes
 * screen in the product" per this task's packet: recipient, amount, fee,
 * a decoded-data preview, tags, and a SHA-256 hash of the exact signing
 * payload with its own copy affordance, all shown before signing is
 * possible. Full addresses only, never truncated (`.value-mono`'s
 * `break-all`, matching the mockup, not `AddressDisplay`'s truncated
 * variant). Never uses the beam as anything but the small identity mark,
 * never uses humor here — this is the one screen the packet's RELEVANT
 * RULES singles out for "maximum clarity, zero cleverness."
 */
export interface SigningApprovalScreenProps {
  origin: string;
  preview: SigningApprovalPreview;
  onReject: () => void;
  /** Rejects (surfacing its message inline) if signing fails after the password is submitted. */
  onSign: (password: string) => Promise<void>;
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
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const isTransfer = preview.recipient !== null;
  const irreversible = isTransfer; // first-seen/unlimited tiering happens upstream in the dispatcher's preview construction.

  const handleSign = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onSign(password);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-[#e5e5e5] px-4 py-3.5">
        <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-[#f5f5f5] text-[10px] font-bold text-[#737373]">
          {hostnameOf(origin).charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-semibold text-[#111111]">{hostnameOf(origin)}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4.5">
        <div className="text-center text-[15px] font-bold text-[#111111]">{REQUEST_KIND_COPY[preview.kind]}</div>

        {isTransfer ? (
          <>
            <div className="flex flex-col items-center gap-1 py-1 text-center">
              <span className="text-[28px] font-semibold tracking-[-0.02em] tabular-nums text-[#111111]">
                {preview.amount ?? "—"}
              </span>
            </div>

            {irreversible ? (
              <div role="alert" className="flex gap-2.5 rounded-[9px] border border-[#ffd6d6] bg-[#fff5f5] p-3.5">
                <WarningIcon />
                <p className="text-xs leading-relaxed text-[#111111]">
                  <strong className="font-bold">This can&apos;t be undone.</strong> Double-check the recipient
                  before signing.
                </p>
              </div>
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
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#737373]">Decoded data</span>
            <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-[9px] border border-[#e5e5e5] bg-[#f5f5f5] p-3 font-mono text-[11px] leading-relaxed text-[#111111]">
              {preview.decodedData}
            </div>
          </div>
        ) : null}

        {preview.tags.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#737373]">Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {preview.tags.map((tag, index) => (
                <span
                  key={index}
                  className="rounded-[6px] bg-[#f5f5f5] px-2 py-1 font-mono text-[10px] text-[#111111]"
                >
                  <span className="text-[#737373]">{tag.name}:</span> {tag.value}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <AddrBlock label="Signing payload (SHA-256)" value={preview.payloadHash} />

        <PasswordField
          label="Password"
          placeholder="Enter your password to sign"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error ? (
          <div role="alert" className="text-xs leading-snug text-[#ff1717]">
            {error}
          </div>
        ) : null}

        <div className="mt-auto flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onReject}
            className="flex-1 rounded-[10px] border border-[#e5e5e5] bg-white py-3 text-sm font-semibold text-[#111111] hover:border-[#a3a3a3]"
          >
            Reject
          </button>
          <Button
            type="button"
            disabled={password.length === 0 || submitting}
            aria-busy={submitting}
            onClick={() => void handleSign()}
            className={`flex-1 rounded-[10px] py-3 ${irreversible ? "bg-[#ff1717] hover:bg-[#ff1717]" : ""}`}
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
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#737373]">{label}</span>
      <div className="flex items-start gap-2 rounded-[9px] border border-[#e5e5e5] bg-white p-3">
        <span className="flex-1 break-all font-mono text-[11px] leading-relaxed text-[#111111]">{value}</span>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void copyToClipboard(value)}
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[7px] text-[#a3a3a3] hover:bg-[#f5f5f5] hover:text-[#737373]"
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#e5e5e5] py-2.5 text-[13px] last:border-b-0 last:border-t last:pt-3">
      <span className="text-[#737373]">{label}</span>
      <span className={`text-right tabular-nums text-[#111111] ${strong ? "font-bold" : "font-semibold"}`}>{value}</span>
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

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-px flex-shrink-0 text-[#ff1717]">
      <path
        d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
