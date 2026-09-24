import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Empty-state pattern — the one sanctioned "release valve" for brand
 * personality (a single dry, understated copy line), and explicitly
 * never the warning-red accent: an empty state is not a problem state.
 */
export interface EmptyStateProps {
  message: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-12 text-center", className)}>
      <p className="m-0 max-w-[260px] text-label text-muted">{message}</p>
      {action}
    </div>
  );
}
