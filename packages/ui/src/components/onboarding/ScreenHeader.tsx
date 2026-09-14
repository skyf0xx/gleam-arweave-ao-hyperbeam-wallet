import type { ReactNode } from "react";
import { cn } from "../../primitives/cn";

/**
 * The back-button + centered title header shared by every onboarding/
 * unlock sub-screen with more than one step (onboarding.html's
 * `.screen-header`, lock-settings.html's identical structure).
 */
export interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  subtitle?: ReactNode;
  className?: string;
}

export function ScreenHeader({ title, onBack, subtitle, className }: ScreenHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2.5 border-b border-[#e5e5e5] px-4 py-3.5", className)}>
      {onBack ? (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] text-[#737373] hover:bg-[#f5f5f5] hover:text-[#111111]"
        >
          <BackIcon />
        </button>
      ) : (
        <div className="h-8 w-8 flex-shrink-0" />
      )}
      <div className="flex flex-1 flex-col items-center gap-px">
        <span className="text-sm font-semibold text-[#111111]">{title}</span>
        {subtitle}
      </div>
      <div className="h-8 w-8 flex-shrink-0" />
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m15 18-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
