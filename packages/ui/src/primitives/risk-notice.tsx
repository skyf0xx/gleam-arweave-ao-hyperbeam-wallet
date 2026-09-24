import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * The explicit-risk-acknowledgment box for the Irreversible/high-exposure
 * tier (e.g. "You haven't sent to this address before"). This is the
 * single component every screen with an Irreversible-tier confirmation
 * composes, rather than each screen inventing its own warning-box markup
 * — the rule that the warning-red accent appears only here is only
 * enforceable if there's one component gating where that color can
 * appear at all.
 *
 * Deliberately has no `tone`/`variant` prop and always renders in the
 * warning palette — a Routine or Consequential screen has no reason to
 * render this component at all, so there is no "safe" variant to
 * accidentally reach for at the wrong tier.
 */
export interface RiskNoticeProps {
  children: ReactNode;
  className?: string;
}

export function RiskNotice({ children, className }: RiskNoticeProps) {
  return (
    <div
      role="alert"
      className={cn("flex gap-2.5 rounded-md border border-warning-border bg-warning-surface px-3.5 py-3", className)}
    >
      <span className="mt-px flex-shrink-0 text-warning">
        <WarningIcon />
      </span>
      <p className="m-0 text-label leading-snug text-foreground">{children}</p>
    </div>
  );
}

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
