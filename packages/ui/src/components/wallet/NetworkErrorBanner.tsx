/**
 * The shared network-unreachable banner (cross-cutting-states.html's
 * `.error-banner` / TODO.md 8.1) — direct, specific, next-step-first
 * copy, no apology theater. Caller supplies `onRetry`; this component
 * never retries on its own.
 */
export interface NetworkErrorBannerProps {
  onRetry: () => void;
}

export function NetworkErrorBanner({ onRetry }: NetworkErrorBannerProps) {
  return (
    <div className="flex items-center gap-2.5 border-b border-[#e5e5e5] bg-[#f5f5f5] px-4 py-3">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="flex-shrink-0 text-[#737373]"
      >
        <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      </svg>
      <p className="flex-1 text-xs leading-snug text-[#111111]">
        Couldn&apos;t reach the network. Retrying &mdash; or check your connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex-shrink-0 p-1 text-xs font-semibold text-[#111111] underline decoration-[#a3a3a3] underline-offset-2"
      >
        Retry
      </button>
    </div>
  );
}
