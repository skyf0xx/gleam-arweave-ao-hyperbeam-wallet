import type { PullToRefreshState } from "./use-pull-to-refresh";

/** Spinner revealed under the header by the pull; it takes no space at rest. */
export function PullToRefreshIndicator({ pull, refreshing, dragging }: PullToRefreshState) {
  if (pull === 0 && !refreshing) return null;
  return (
    <div
      role={refreshing ? "status" : undefined}
      aria-label={refreshing ? "Refreshing" : undefined}
      style={{ height: pull }}
      className={`flex items-center justify-center overflow-hidden ${dragging ? "" : "motion-safe:transition-[height] motion-safe:duration-200"}`}
    >
      <span
        aria-hidden="true"
        style={refreshing ? undefined : { transform: `rotate(${pull * 4}deg)`, opacity: Math.min(pull / 32, 1) }}
        className={`h-5 w-5 rounded-full border-2 border-muted/30 border-t-muted ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
      />
    </div>
  );
}
