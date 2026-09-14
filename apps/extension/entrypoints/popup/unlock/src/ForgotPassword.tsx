import { useState } from "react";

/**
 * 1.5b Forgot password (unlock-screen.html) — explicit, plainly-worded
 * destructive reset, never a silent delete (RELEVANT RULES). Requires an
 * extra confirmation tap before `onReset` fires, on top of the screen's
 * own explicit copy — the mockup names one primary action, but the
 * consequence (wiping every locally stored vault) is Irreversible-tier
 * per brand/guidelines.md Part 3, which asks for "explicit acknowledgment
 * of the specific stated risk," not a single click doing it.
 */
export interface ForgotPasswordProps {
  onReset: () => void;
  onCancel: () => void;
}

export function ForgotPassword({ onReset, onCancel }: ForgotPasswordProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-8 pb-6 pt-10 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-[#f5f5f5] text-[#737373]">
        <LockGlyph />
      </div>
      <h2 className="text-base font-semibold text-[#111111]">Forgot password?</h2>
      <p className="text-[13px] leading-relaxed text-[#737373]">
        Gleam doesn&apos;t store your password and can&apos;t recover it. Resetting removes every
        wallet stored in this browser &mdash; you&apos;ll need each wallet&apos;s backup keyfile
        to bring it back.
      </p>

      {confirming ? (
        <p role="alert" className="text-[13px] font-medium leading-relaxed text-[#ff1717]">
          This can&apos;t be undone. Any wallet without a backup keyfile is lost permanently.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => (confirming ? onReset() : setConfirming(true))}
        className="mt-8 w-full rounded-[10px] bg-[#ff1717] py-3 text-sm font-semibold text-white hover:brightness-110"
      >
        {confirming ? "Yes, reset wallet" : "Reset wallet"}
      </button>
      <button
        type="button"
        onClick={confirming ? () => setConfirming(false) : onCancel}
        className="p-1 text-xs font-medium text-[#737373] hover:text-[#111111] hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
      <path d="M12 14v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="14.2" r="0.6" fill="currentColor" />
    </svg>
  );
}
