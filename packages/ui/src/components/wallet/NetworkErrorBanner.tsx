import { useEffect, useState } from "react";
import { cn } from "../../primitives/cn";

/** A retry that fails faster than this would bring the banner straight back, as if the tap did nothing. */
export const NETWORK_RETRY_MIN_MS = 700;

/**
 * The shared network-unreachable banner — direct, specific,
 * next-step-first copy, no apology theater. Caller supplies `onRetry`;
 * this component never retries on its own.
 */
export interface NetworkErrorBannerProps {
  onRetry: () => void;
  /** True while the caller's retry is in flight; the button shows it's working instead of going quiet. */
  retrying?: boolean;
  /** On the phone the banner insets itself to the gutter; `phone:mx-0` where the parent already does. */
  className?: string;
}

export function NetworkErrorBanner({ onRetry, retrying = false, className }: NetworkErrorBannerProps) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!held) return;
    const timer = window.setTimeout(() => setHeld(false), NETWORK_RETRY_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [held]);
  const busy = retrying || held;

  return (
    <div className={cn("flex items-center gap-2.5 border-b border-line bg-mist px-4 py-3 phone:mx-5 phone:mt-2 phone:rounded-xl phone:border-b-0 phone:py-1.5 phone:pl-3.5 phone:pr-1", className)}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="flex-shrink-0 text-muted"
      >
        <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      </svg>
      <p className="flex-1 text-caption leading-snug text-foreground">
        Couldn&apos;t reach the network. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={() => {
          setHeld(true);
          onRetry();
        }}
        disabled={busy}
        aria-busy={busy || undefined}
        className="flex flex-shrink-0 items-center gap-1.5 p-1 text-caption font-semibold text-foreground underline decoration-faint underline-offset-2 disabled:text-muted disabled:no-underline phone:min-h-11 phone:px-3"
      >
        {busy ? (
          <>
            <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-muted/30 border-t-muted animate-spin motion-reduce:animate-none" />
            Retrying
          </>
        ) : (
          "Retry"
        )}
      </button>
    </div>
  );
}
