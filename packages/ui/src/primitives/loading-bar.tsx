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
  /** A refresh the person asked for is in flight. Background reads never show the bar. */
  active: boolean;
  className?: string;
}

/** A 1px beam pinned to the top edge while a refresh the person asked for runs. */
export function LoadingBar({ active, className }: LoadingBarProps) {
  const labels = useUiLabels();
  // Kept mounted after a read ends so the bar fades out instead of cutting.
  const [shown, setShown] = useState(active);
  useEffect(() => {
    if (active) setShown(true);
  }, [active]);
  return (
    <div
      role="status"
      aria-label={active ? labels.refreshing : undefined}
      className={cn("pointer-events-none fixed inset-x-0 top-[var(--inset-top)] z-50 h-px overflow-hidden", className)}
    >
      {shown ? (
        <div
          aria-hidden="true"
          onTransitionEnd={() => {
            if (!active) setShown(false);
          }}
          className={cn(
            "h-full w-full transition-opacity duration-300",
            active ? "opacity-100" : "opacity-0",
          )}
        >
          {/* The divider's own height and radius are clipped by this 1px box. */}
          <div className={"gleam-beam-divider gleam-loading-sweep w-full rounded-none"} />
        </div>
      ) : null}
    </div>
  );
}
