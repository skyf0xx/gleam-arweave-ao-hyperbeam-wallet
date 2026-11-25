import { useEffect, useRef, type RefObject } from "react";
import { bindTouchGesture } from "@gleam/ui/src/primitives/touch-gesture.ts";

/** A pull that starts with the list at its top, or on its handle. */
const PULL_PX = 28;
/** A pull that starts as a scroll and carries on past the top, where it's easier to do by accident. */
const CARRIED_PULL_PX = 48;
const FLICK_MIN_PX = 10;
const FLICK_PX_PER_MS = 0.5;
/** Movement needed before the gesture's direction is judged. */
const DIRECTION_SLOP_PX = 8;
const WHEEL_PULL_PX = 32;
const RETURN_MS = 220;

/** Ease-out quint, shared by every slide of the sheet so they move alike. */
export const SHEET_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface UndockPullOptions {
  docked: boolean;
  section: RefObject<HTMLElement | null>;
  /** The pinned header: with the section's tab row, it pulls whatever the list's scroll. */
  header: RefObject<HTMLElement | null>;
  onUndock: () => void;
}

/**
 * Docked, the list scrolls on its own, while the header waits on the
 * window, which sits a whole header's height down behind it. A pull past
 * the list's top would otherwise scroll that hidden window with nothing
 * moving on screen (and a trackpad gesture stays latched to the list, so
 * the first one does nothing at all). So the list follows the pull, and
 * past a short distance the header comes straight back.
 *
 * Returns how far the list had been pulled when it undocked, so the slide
 * back into place starts from there.
 */
export function useUndockPull({ docked, section: sectionRef, header: headerRef, onUndock }: UndockPullOptions): RefObject<number> {
  const pulledBy = useRef(0);
  const undockRef = useRef(onUndock);
  useEffect(() => {
    undockRef.current = onUndock;
  });

  useEffect(() => {
    const section = sectionRef.current;
    const header = headerRef.current;
    if (!docked || !section) return;
    pulledBy.current = 0;
    let wheelPull = 0;
    let active = false;
    let onHandle = false;
    /** Where the finger was when the list had nothing left to scroll. */
    let anchor: number | null = null;
    let threshold = PULL_PX;
    let decided = false;
    let startX = 0;
    let startY = 0;
    let pull = 0;
    let last = { y: 0, time: 0 };
    let speed = 0;

    const follow = (distance: number) => {
      pull = distance;
      section.style.translate = distance > 0 ? `0 ${distance}px` : "";
    };
    const release = () => {
      active = false;
      if (pull > 0 && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        section.animate?.([{ translate: `0 ${pull}px` }, { translate: "0 0" }], { duration: RETURN_MS, easing: SHEET_EASING });
      }
      follow(0);
    };
    const undock = () => {
      pulledBy.current = pull;
      active = false;
      follow(0);
      undockRef.current();
    };

    const onWheel = (event: WheelEvent) => {
      if (section.scrollTop > 0 || event.deltaY >= 0) {
        wheelPull = 0;
        return;
      }
      wheelPull -= event.deltaY;
      if (wheelPull >= WHEEL_PULL_PX) undock();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (active) release();
        return;
      }
      const touch = event.touches[0]!;
      const from = event.target instanceof Element ? event.target : null;
      onHandle = Boolean(from && (header?.contains(from) || from.closest("[data-drawer-handle]")));
      active = true;
      anchor = onHandle || section.scrollTop <= 0 ? touch.clientY : null;
      threshold = anchor === null ? CARRIED_PULL_PX : PULL_PX;
      decided = false;
      startX = touch.clientX;
      startY = touch.clientY;
      last = { y: touch.clientY, time: event.timeStamp };
      speed = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!active || !touch) return;
      const { clientX: x, clientY: y } = touch;
      if (!decided) {
        const across = Math.abs(x - startX);
        const along = Math.abs(y - startY);
        if (Math.max(across, along) < DIRECTION_SLOP_PX) return;
        decided = true;
        // A swipe between tabs isn't a pull.
        if (across > along) {
          active = false;
          return;
        }
      }
      const elapsed = event.timeStamp - last.time;
      if (elapsed > 0) speed = (y - last.y) / elapsed;
      last = { y, time: event.timeStamp };
      if (!onHandle && section.scrollTop > 0) {
        anchor = null;
        threshold = CARRIED_PULL_PX;
        follow(0);
        return;
      }
      anchor ??= y;
      follow(Math.max(0, y - anchor));
      if (pull > 0 && event.cancelable) event.preventDefault();
      if (pull >= threshold) undock();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!active) return;
      const flick = threshold === PULL_PX && pull >= FLICK_MIN_PX && speed >= FLICK_PX_PER_MS && event.timeStamp - last.time < 100;
      if (flick && event.type === "touchend") undock();
      else release();
    };

    section.addEventListener("wheel", onWheel, { passive: true });
    const touched = header ? [section, header] : [section];
    const unbind = touched.map((element) =>
      bindTouchGesture(element, { onStart: onTouchStart, onMove: onTouchMove, onEnd: onTouchEnd }),
    );
    return () => {
      section.removeEventListener("wheel", onWheel);
      section.style.translate = "";
      for (const stop of unbind) stop();
    };
  }, [docked, sectionRef, headerRef]);

  return pulledBy;
}
