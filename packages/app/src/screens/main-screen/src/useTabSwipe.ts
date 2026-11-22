import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Movement needed before the gesture's direction is judged. A thumb on a scrolling list rarely moves level, so a swipe needs only to lean sideways (`dx` over 0.9 × `dy`). */
const DIRECTION_SLOP_PX = 6;
/** A start this close to the side is the system's own back swipe. */
const SCREEN_EDGE_PX = 20;
/** Past either end the panel resists rather than stopping dead. */
const END_RESISTANCE = 0.25;
/** A slow drag changes tab past this share of the width; a flick needs only the speed. */
const COMMIT_SHARE = 0.15;
const FLICK_PX_PER_MS = 0.2;
/** On the home view nothing tracks the finger, so a swipe has to be a clear one. */
const OPEN_PX = 32;
const SETTLE_MS = 200;
const DOCK_MS = 220;

/** Both gutters, so the next panel waits just off screen. */
export const PANEL_GAP_PX = 40;

export interface TabSwipeOptions {
  /** Receives the touches. */
  target: RefObject<HTMLElement | null>;
  /** Holds the panels and moves with the finger. */
  track: RefObject<HTMLElement | null>;
  /** The docked list, which scrolls vertically. */
  scroller: RefObject<HTMLElement | null>;
  active: number;
  count: number;
  docked: boolean;
  /** A panel is about to come into view. */
  onPeek: (index: number) => void;
  onSelect: (index: number) => void;
  /** Undocked, a swipe opens the list before it changes tab. */
  onOpen: () => void;
}

/** The panel beside the active one, and where its top sits against the active panel's. */
export interface PeekedPanel {
  index: number;
  top: number;
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Whether something under the finger still scrolls that way itself, such as the collectibles stage. */
function scrollsSideways(from: EventTarget | null, until: HTMLElement, towardsNext: boolean): boolean {
  for (let node = from instanceof Element ? from : null; node && node !== until; node = node.parentElement) {
    const room = node.scrollWidth - node.clientWidth;
    if (room <= 1 || !/auto|scroll/.test(getComputedStyle(node).overflowX)) continue;
    if (towardsNext ? node.scrollLeft < room - 1 : node.scrollLeft > 1) return true;
  }
  return false;
}

/**
 * Swiping between the home screen's tabs, on the phone layout only. Docked,
 * the panels follow the finger and settle from where it let go. Undocked,
 * a swipe opens the list and then slides to the next tab, one after the other.
 */
export function useTabSwipe(options: TabSwipeOptions): PeekedPanel | null {
  const { target, track, scroller, active, docked } = options;
  const [peek, setPeek] = useState<PeekedPanel | null>(null);
  const latest = useRef(options);
  const pending = useRef<number | null>(null);
  const settleFrom = useRef<number | null>(null);
  const settling = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    latest.current = options;
  });

  const step = () => (track.current?.clientWidth ?? 0) + PANEL_GAP_PX;

  const settle = (from: number) => {
    const element = track.current;
    if (!element) return;
    element.style.transform = "";
    settling.current?.cancel();
    settling.current = null;
    if (from === 0 || reducedMotion() || !element.animate) {
      setPeek(null);
      return;
    }
    const animation = element.animate([{ transform: `translateX(${from}px)` }, { transform: "none" }], {
      duration: SETTLE_MS,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
    settling.current = animation;
    animation.onfinish = () => {
      settling.current = null;
      setPeek(null);
    };
  };

  /** Changes tab with the panels where they are, `x` px off, then lets them settle. */
  const goTo = (next: number, x: number) => {
    const { active: from, onPeek, onSelect } = latest.current;
    const direction = next > from ? 1 : -1;
    settleFrom.current = x + direction * step();
    onPeek(next);
    // The tab being left keeps its place on screen although the list goes back to its top.
    setPeek({ index: from, top: -(scroller.current?.scrollTop ?? 0) });
    onSelect(next);
  };

  useLayoutEffect(() => {
    const from = settleFrom.current;
    settleFrom.current = null;
    if (from === null) {
      settling.current?.cancel();
      settling.current = null;
      if (track.current) track.current.style.transform = "";
      setPeek(null);
      return;
    }
    if (scroller.current) scroller.current.scrollTop = 0;
    settle(from);
    // Only a tab change settles; the callbacks read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!docked || pending.current === null) return;
    const timer = window.setTimeout(
      () => {
        const next = pending.current;
        pending.current = null;
        if (next !== null && next !== latest.current.active) goTo(next, 0);
      },
      reducedMotion() ? 0 : DOCK_MS,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked]);

  useEffect(() => {
    const element = target.current;
    if (!element?.closest('[data-layout="phone"]')) return;

    let phase: "idle" | "undecided" | "dragging" | "opening" = "idle";
    let startX = 0;
    let startY = 0;
    let base = 0;
    let x = 0;
    let peeked: number | null = null;
    let last = { x: 0, time: 0 };
    let speed = 0;

    const onStart = (event: TouchEvent) => {
      // A second finger ends the swipe where it is.
      if (event.touches.length !== 1) {
        if (phase === "dragging") settle(x);
        phase = "idle";
        return;
      }
      pending.current = null;
      const touch = event.touches[0]!;
      startX = touch.clientX;
      startY = touch.clientY;
      last = { x: startX, time: event.timeStamp };
      speed = 0;
      x = 0;
      peeked = null;
      const atEdge = startX < SCREEN_EDGE_PX || startX > window.innerWidth - SCREEN_EDGE_PX;
      phase = atEdge ? "idle" : "undecided";
    };

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (phase === "idle" || !touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (phase === "undecided") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_SLOP_PX) return;
        if (Math.abs(dx) <= Math.abs(dy) * 0.9 || scrollsSideways(event.target, element, dx < 0)) {
          phase = "idle";
          return;
        }
        if (latest.current.docked) {
          // A new swipe takes over a panel still settling, from where it is.
          base = settling.current && track.current && typeof DOMMatrix !== "undefined"
            ? new DOMMatrix(getComputedStyle(track.current).transform).m41
            : 0;
          settling.current?.cancel();
          settling.current = null;
          phase = "dragging";
        } else phase = "opening";
        // Measured from here, so the panel doesn't jump the distance it took to decide.
        startX = touch.clientX;
      }
      if (event.cancelable) event.preventDefault();
      const elapsed = event.timeStamp - last.time;
      if (elapsed > 0) speed = (touch.clientX - last.x) / elapsed;
      last = { x: touch.clientX, time: event.timeStamp };
      x = base + touch.clientX - startX;
      if (phase === "opening") return;

      const { active: at, count, onPeek } = latest.current;
      const next = at + (x < 0 ? 1 : -1);
      const exists = next >= 0 && next < count;
      if (!exists) x *= END_RESISTANCE;
      else if (peeked !== next) {
        peeked = next;
        onPeek(next);
        setPeek({ index: next, top: scroller.current?.scrollTop ?? 0 });
      }
      if (track.current) track.current.style.transform = `translateX(${x}px)`;
    };

    const onEnd = (event: TouchEvent) => {
      const was = phase;
      phase = "idle";
      const moved = x;
      base = 0;
      if (was !== "dragging" && was !== "opening") return;
      const { active: at, count, onOpen } = latest.current;
      const next = at + (moved < 0 ? 1 : -1);
      const exists = moved !== 0 && next >= 0 && next < count;
      // A finger held still before it lifts isn't a flick.
      const flick = event.timeStamp - last.time < 100 && Math.abs(speed) >= FLICK_PX_PER_MS && Math.sign(speed) === Math.sign(moved);
      const cancelled = event.type === "touchcancel";
      if (was === "opening") {
        if (cancelled || !exists || !(flick || Math.abs(moved) >= OPEN_PX)) return;
        pending.current = next;
        onOpen();
        return;
      }
      if (!cancelled && exists && (flick || Math.abs(moved) >= step() * COMMIT_SHARE)) goTo(next, moved);
      else settle(moved);
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive so a swipe we own can't also scroll the list.
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
    // Everything else is read through `latest`, so a drag survives a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, track, scroller]);

  return peek;
}
