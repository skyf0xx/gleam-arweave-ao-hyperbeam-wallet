import { useEffect, useState } from "react";
import { cn } from "./cn";
import { useUiLabels } from "../labels";

/**
 * True from the moment `cached` goes from true to false, for the rest of the
 * mount: the one-shot `gleam-fresh` class runs its animation once when added.
 * Data that was never cached on this mount never gets it.
 */
export function useFreshAfterCache(cached: boolean): boolean {
  const [wasCached, setWasCached] = useState(cached);
  if (cached && !wasCached) setWasCached(true);
  return wasCached && !cached;
}

export interface LoadingBarProps {
  /** A read the screen is waiting on is in flight. */
  active: boolean;
  /** The last read failed and nothing is in flight; the screen retries on its own. */
  failed?: boolean;
  className?: string;
}

/**
 * The screen's only loading cue: a 1px beam pinned to the top edge. It shows
 * only after a short delay, so a read that lands quickly shows nothing.
 */
export function LoadingBar({ active, failed = false, className }: LoadingBarProps) {
  const labels = useUiLabels();
  // Kept mounted after a read ends so the bar fades out instead of cutting.
  const [shown, setShown] = useState(active);
  useEffect(() => {
    if (active) setShown(true);
  }, [active]);
  const resting = failed && !active;
  return (
    <div
      role="status"
      aria-label={active ? labels.refreshing : resting ? labels.networkError.message : undefined}
      className={cn("pointer-events-none fixed inset-x-0 top-[var(--inset-top)] z-50 h-px overflow-hidden", className)}
    >
      {shown || resting ? (
        <div
          aria-hidden="true"
          onTransitionEnd={() => {
            if (!active) setShown(false);
          }}
          className={cn(
            "h-full w-full transition-opacity duration-300",
            active ? "opacity-100 delay-300" : resting ? "opacity-50" : "opacity-0",
          )}
        >
          {/* The divider's own height and radius are clipped by this 1px box. */}
          <div className={cn("gleam-beam-divider w-full rounded-none", !resting && "gleam-loading-sweep")} />
        </div>
      ) : null}
    </div>
  );
}
