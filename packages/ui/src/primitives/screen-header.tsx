import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The back-button + centered title header shared by every multi-step
 * screen across the reference mockups (shared.css `.screen-header`,
 * identical structure repeated in onboarding.html, send-flow.html,
 * wallet-detail.html, lock-settings.html, network-peers.html, and
 * more). The token-consuming, shared version of the pattern
 * `components/onboarding/ScreenHeader.tsx` built ad hoc with hardcoded
 * hex values before this package's token layer existed — see this
 * task's declared debt for the migration this leaves for screen layers.
 */
export interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  end?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}

export function ScreenHeader({ title, onBack, end, subtitle, className }: ScreenHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2.5 border-b border-line px-4 py-3.5", className)}>
      {onBack ? (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-mist hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
        >
          <BackIcon />
        </button>
      ) : (
        <div className="h-8 w-8 flex-shrink-0" aria-hidden="true" />
      )}
      <div className="flex flex-1 flex-col items-center gap-px">
        <span className="text-body font-semibold text-foreground">{title}</span>
        {subtitle}
      </div>
      {end ?? <div className="h-8 w-8 flex-shrink-0" aria-hidden="true" />}
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
