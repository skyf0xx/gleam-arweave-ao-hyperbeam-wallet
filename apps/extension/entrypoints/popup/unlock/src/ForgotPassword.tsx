import { useState } from "react";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * 1.5b Forgot password (unlock-screen.html) — explicit, plainly-worded
 * destructive reset, never a silent delete (RELEVANT RULES). Requires an
 * extra confirmation tap before `onReset` fires, on top of the screen's
 * own explicit copy — the mockup names one primary action, but the
 * consequence (wiping every locally stored vault) is Irreversible-tier
 * per brand/guidelines.md Part 3, which asks for "explicit acknowledgment
 * of the specific stated risk," not a single click doing it. The reset
 * action uses the shared `Button variant="destructive"` (the only place
 * the warning-red accent is allowed to render) rather than a hand-rolled
 * red button — this screen's own risk-tier framing is exactly what that
 * variant exists for.
 */
export interface ForgotPasswordProps {
  onReset: () => void;
  onCancel: () => void;
}

export function ForgotPassword({ onReset, onCancel }: ForgotPasswordProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-8 pb-6 pt-10 text-center">
      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-mist text-muted">
        <LockGlyph />
      </div>
      <h2 className="text-body font-semibold text-foreground">Forgot password?</h2>
      <p className="text-body leading-relaxed text-muted">
        Gleam doesn&apos;t store your password and can&apos;t recover it. Resetting removes every
        wallet stored in this browser &mdash; you&apos;ll need each wallet&apos;s backup keyfile
        to bring it back.
      </p>

      {confirming ? (
        <p role="alert" className="text-body font-medium leading-relaxed text-warning">
          This can&apos;t be undone. Any wallet without a backup keyfile is lost permanently.
        </p>
      ) : null}

      <Button
        type="button"
        variant="destructive"
        onClick={() => (confirming ? onReset() : setConfirming(true))}
        className="mt-8"
      >
        {confirming ? "Yes, reset wallet" : "Reset wallet"}
      </Button>
      <button
        type="button"
        onClick={confirming ? () => setConfirming(false) : onCancel}
        className="p-1 text-label font-medium text-muted hover:text-foreground hover:underline"
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
