import { useEffect, useLayoutEffect, useRef, useState } from "react";

const COUNT_MS = 800;
const HIGHLIGHT_MS = 1600;

/**
 * Counts `value` (an atomic-integer string) up from the last shown value
 * when `trigger` changes between two loaded states, such as a refreshed
 * settled total after an invited friend joins. The total also ticks every
 * second, so a plain change in `value` is never animated. A null trigger
 * means nothing is loaded yet, and the first load never animates.
 */
export function useCountUp(value: string, trigger: string | null): { shown: string; highlighted: boolean } {
  const [counting, setCounting] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const valueRef = useRef(value);
  const lastShownRef = useRef(value);
  const lastTriggerRef = useRef(trigger);
  const frameRef = useRef(0);
  const highlightTimerRef = useRef(0);
  valueRef.current = value;

  // A layout effect, so the count starts from the old number before the
  // new total is ever painted.
  useLayoutEffect(() => {
    const previousTrigger = lastTriggerRef.current;
    lastTriggerRef.current = trigger;
    if (previousTrigger === null || trigger === null || trigger === previousTrigger) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const from = BigInt(lastShownRef.current);
    if (reduced || BigInt(value) <= from) return;

    cancelAnimationFrame(frameRef.current);
    window.clearTimeout(highlightTimerRef.current);
    setCounting(from.toString());
    setHighlighted(true);
    highlightTimerRef.current = window.setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_MS);
      if (progress >= 1) {
        setCounting(null);
        return;
      }
      const eased = 1 - (1 - progress) ** 3;
      const target = BigInt(valueRef.current);
      setCounting((from + ((target - from) * BigInt(Math.round(eased * 1000))) / 1000n).toString());
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    // Only a trigger change starts a count; the ticking value is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const shown = counting ?? value;
  useLayoutEffect(() => {
    lastShownRef.current = shown;
  }, [shown]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  return { shown, highlighted };
}
