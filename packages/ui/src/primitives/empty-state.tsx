import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Empty-state pattern (shared.css/tokens-activity.html `.empty-state`,
 * 4.5). Per brand/identity.md's Design Principle 5 and
 * brand/guidelines.md Part 3: this is the *one* sanctioned "release
 * valve" for brand personality (a single dry, understated copy line) —
 * and explicitly never the warning-red accent, since "an empty state is
 * not a problem state." `EmptyState` renders a short neutral line mark
 * (never the beam, never a mascot) rather than accepting an icon prop,
 * so a screen can't accidentally reach for the warning or beam palette
 * here.
 */
export interface EmptyStateProps {
  message: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-12 text-center", className)}>
      <span aria-hidden="true" className="h-[3px] w-8 rounded-sm bg-line" />
      <p className="m-0 max-w-[260px] text-label text-muted">{message}</p>
      {action}
    </div>
  );
}
