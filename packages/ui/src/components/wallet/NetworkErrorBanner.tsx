import { cn } from "../../primitives/cn";

/**
 * The shared network-unreachable banner — direct, specific,
 * next-step-first copy, no apology theater. Caller supplies `onRetry`;
 * this component never retries on its own.
 */
export interface NetworkErrorBannerProps {
  onRetry: () => void;
  /** On the phone the banner insets itself to the gutter; `phone:mx-0` where the parent already does. */
  className?: string;
}

export function NetworkErrorBanner({ onRetry, className }: NetworkErrorBannerProps) {
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
        onClick={onRetry}
        className="flex-shrink-0 p-1 text-caption font-semibold text-foreground underline decoration-faint underline-offset-2 phone:flex phone:min-h-11 phone:items-center phone:px-3"
      >
        Retry
      </button>
    </div>
  );
}
