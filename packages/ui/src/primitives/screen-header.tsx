import type { ReactNode } from "react";
import { useBackHandler } from "./back-stack";
import { cn } from "./cn";
import { useUiLabels } from "../labels";

/**
 * The back-button + centered title header shared by every multi-step
 * screen. The token-consuming, shared version of the pattern
 * `components/onboarding/ScreenHeader.tsx` built ad hoc with hardcoded
 * hex values before this package's token layer existed.
 */
export interface ScreenHeaderProps {
  title?: string;
  /** Takes the title's place, e.g. a row of tabs. */
  center?: ReactNode;
  onBack?: () => void;
  /**
   * While true the system back press (Android) is consumed without leaving, for a screen whose
   * action is in flight. The arrow on screen is the caller's own business and is unchanged.
   */
  busy?: boolean;
  end?: ReactNode;
  subtitle?: ReactNode;
  /** Accessible name of the back arrow. */
  backLabel?: string;
  className?: string;
}

export function ScreenHeader({ title, center, onBack, busy = false, end, subtitle, backLabel, className }: ScreenHeaderProps) {
  const labels = useUiLabels();
  useBackHandler(onBack ? (busy ? ignoreBack : onBack) : null);
  return (
    <div className={cn("gleam-frost-bar flex items-center gap-2.5 border-b border-line silica:border-transparent px-4 py-3.5 phone:sticky phone:top-[var(--safe-top)] phone:z-30 phone:gap-1 phone:border-b-0 phone:bg-background phone:px-2 phone:py-1", className)}>
      {onBack ? (
        <button
          type="button"
          aria-label={backLabel ?? labels.back}
          onClick={onBack}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground phone:h-11 phone:w-11 phone:active:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
        >
          <BackIcon />
        </button>
      ) : (
        <div className="h-8 w-8 flex-shrink-0 phone:h-11 phone:w-11" aria-hidden="true" />
      )}
      <div className="flex flex-1 flex-col items-center gap-px">
        {/* eslint-disable-next-line gleam/type-scale -- the phone's screen title is 16px, between Body and H3, as iOS and Android titles are. */}
        {center ?? <span className="text-body font-semibold text-foreground phone:text-[1rem]">{title}</span>}
        {subtitle}
      </div>
      {end ?? <div className="h-8 w-8 flex-shrink-0 phone:h-11 phone:w-11" aria-hidden="true" />}
    </div>
  );
}

function ignoreBack() {}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
