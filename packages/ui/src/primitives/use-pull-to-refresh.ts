import { useEffect, useRef, useState, type RefObject } from "react";

/** Finger travel is damped to this fraction, so the pull feels like it is stretching. */
const RESISTANCE = 0.6;
const MAX_PULL_PX = 96;
/** Movement needed before the gesture's direction is judged; below it a tap's jitter decides nothing. */
const DIRECTION_SLOP_PX = 6;

export const PULL_TO_REFRESH_THRESHOLD_PX = 64;

export interface UsePullToRefreshOptions {
  /** Element that receives the touches; the gesture only runs while the window is scrolled to the top. */
  target: RefObject<HTMLElement | null>;
  /** Resolves when the refresh is done. A pull released while one is pending does nothing. */
  onRefresh: () => Promise<unknown>;
  threshold?: number;
}

export interface PullToRefreshState {
  /** Damped distance the content has been pulled down, in px. */
  pull: number;
  refreshing: boolean;
  /** True while a finger is dragging, so the indicator tracks it without easing. */
  dragging: boolean;
}

type Phase = "idle" | "undecided" | "pulling" | "ignored";

/**
 * Pull-down-to-refresh from raw touch events: the phone layout sets
 * `overscroll-behavior: none`, so the browser offers no native pull. Active
 * only inside `[data-layout="phone"]`, which the popup and side panel lack.
 */
export function usePullToRefresh({
  target,
  onRefresh,
  threshold = PULL_TO_REFRESH_THRESHOLD_PX,
}: UsePullToRefreshOptions): PullToRefreshState {
  const [state, setState] = useState<PullToRefreshState>({ pull: 0, refreshing: false, dragging: false });
  const refreshRef = useRef(onRefresh);
  const refreshingRef = useRef(false);

  useEffect(() => {
    refreshRef.current = onRefresh;
  });

  useEffect(() => {
    const element = target.current;
    if (!element?.closest('[data-layout="phone"]')) return;

    let phase: Phase = "idle";
    let startX = 0;
    let startY = 0;
    let pull = 0;

    const reset = () => {
      phase = "idle";
      pull = 0;
    };

    const onStart = (event: TouchEvent) => {
      reset();
      if (refreshingRef.current || event.touches.length !== 1 || window.scrollY > 0) {
        phase = "ignored";
        return;
      }
      const touch = event.touches[0]!;
      startX = touch.clientX;
      startY = touch.clientY;
      phase = "undecided";
    };

    const onMove = (event: TouchEvent) => {
      if (phase === "idle" || phase === "ignored") return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (phase === "undecided") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_SLOP_PX) return;
        // A horizontal or upward start belongs to the page (carousels, normal scrolling).
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
          phase = "ignored";
          return;
        }
        phase = "pulling";
      }
      // Only a gesture we own is cancelled; everywhere else the move stays passive-friendly.
      if (event.cancelable) event.preventDefault();
      pull = Math.min(Math.max(dy, 0) * RESISTANCE, MAX_PULL_PX);
      setState({ pull, refreshing: false, dragging: true });
    };

    const onEnd = () => {
      const wasPulling = phase === "pulling";
      const reached = pull >= threshold;
      reset();
      if (!wasPulling) return;
      if (!reached || refreshingRef.current) {
        setState({ pull: 0, refreshing: refreshingRef.current, dragging: false });
        return;
      }
      refreshingRef.current = true;
      setState({ pull: threshold, refreshing: true, dragging: false });
      const settle = () => {
        refreshingRef.current = false;
        setState({ pull: 0, refreshing: false, dragging: false });
      };
      try {
        refreshRef.current().then(settle, settle);
      } catch {
        settle();
      }
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive so a pull we own can cancel the scroll; onMove bails before preventDefault otherwise.
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, [target, threshold]);

  return state;
}
