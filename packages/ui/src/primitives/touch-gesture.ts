export interface TouchGestureHandlers {
  onStart: (event: TouchEvent) => void;
  onMove: (event: TouchEvent) => void;
  /** Runs for both `touchend` and `touchcancel`; check `event.type` to tell them apart. */
  onEnd: (event: TouchEvent) => void;
}

/** Listens for one touch gesture on `element` and returns the function that stops. */
export function bindTouchGesture(element: HTMLElement, { onStart, onMove, onEnd }: TouchGestureHandlers): () => void {
  element.addEventListener("touchstart", onStart, { passive: true });
  // Non-passive so a gesture the handler owns can cancel the scroll.
  element.addEventListener("touchmove", onMove, { passive: false });
  element.addEventListener("touchend", onEnd);
  element.addEventListener("touchcancel", onEnd);
  return () => {
    element.removeEventListener("touchstart", onStart);
    element.removeEventListener("touchmove", onMove);
    element.removeEventListener("touchend", onEnd);
    element.removeEventListener("touchcancel", onEnd);
  };
}
