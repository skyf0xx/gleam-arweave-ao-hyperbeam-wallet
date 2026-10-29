import { useLayoutEffect, useRef, useState } from "react";

export const ANIMATED_NUMBER_DURATION_MS = 700;

/** Below this relative change a new figure swaps in; a tick that small reads as flicker. */
const MIN_TICK_CHANGE = 0.01;
const TINY = 1e-9;

const PLAIN_DECIMAL = /^-?\d+(?:\.(\d+))?$/;

/** Formats a frame like `text`, for a plain decimal such as "12.3456". Anything else isn't animated. */
function plainDecimalFormat(text: string): ((value: number) => string) | null {
  const match = PLAIN_DECIMAL.exec(text);
  if (!match) return null;
  const digits = match[1]?.length ?? 0;
  return (value) => value.toFixed(digits);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

export interface AnimatedNumberProps {
  /**
   * The figure in display units, used only to draw the frames in between.
   * Amounts stay atomic strings everywhere else; this float never feeds
   * any math or the final text.
   */
  value: number;
  /** The exact string to show at rest. */
  text: string;
  /** Formats a frame in between. Defaults to `text`'s decimal places, for a plain decimal. */
  format?: (value: number) => string;
  /**
   * What `value` is measured in, such as the display currency. A change
   * swaps to the new text: ticking a dollar figure through a euro format
   * would show amounts that were never true.
   */
  unit?: string;
  /**
   * While true, keep showing the last settled text and start no tick, so
   * inputs that land one after another produce a single tick once they've
   * all settled. A `unit` change ignores it and swaps.
   */
  hold?: boolean;
}

/**
 * Returns what to show for `value`: `text`, or while `value` has just
 * changed, frames ticking from the old figure to the new. The first value,
 * a new `unit`, a change under 1%, a reduced-motion preference, or a
 * `text` with no `format` for its frames swaps straight to the new text.
 */
export function useAnimatedNumber({ value, text, format, unit, hold = false }: AnimatedNumberProps): string {
  const [frame, setFrame] = useState<string | null>(null);
  const shownRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const unitRef = useRef(unit);
  const formatRef = useRef(format);
  formatRef.current = format;
  const settledTextRef = useRef(text);
  // A stand-in value (NaN) or another unit has no settled figure to hold.
  const holding = hold && unitRef.current === unit && Number.isFinite(value);
  if (!holding && frame === null) settledTextRef.current = text;

  useLayoutEffect(() => {
    if (holding) {
      shownRef.current ??= value;
      return;
    }
    const from = unitRef.current === unit ? shownRef.current : null;
    unitRef.current = unit;
    const formatFrame = formatRef.current ?? plainDecimalFormat(text);
    const cancel = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    cancel();
    if (from === null || from === value || !Number.isFinite(from) || !Number.isFinite(value) || !formatFrame || prefersReducedMotion() || Math.abs(value - from) / Math.max(Math.abs(from), TINY) < MIN_TICK_CHANGE) {
      shownRef.current = value;
      setFrame(null);
      return;
    }

    setFrame(formatFrame(from));
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const progress = Math.min((now - start) / ANIMATED_NUMBER_DURATION_MS, 1);
      if (progress >= 1) {
        rafRef.current = null;
        shownRef.current = value;
        setFrame(null);
        return;
      }
      const current = from + (value - from) * easeOutQuart(progress);
      // A retarget mid-tick starts from what's on screen, not the old target.
      shownRef.current = current;
      setFrame(formatFrame(current));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return cancel;
    // `text` follows `value`; only a new figure starts a tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unit, holding]);

  return holding ? (frame ?? settledTextRef.current) : (frame ?? text);
}

/** `useAnimatedNumber` as an inline element. */
export function AnimatedNumber(props: AnimatedNumberProps) {
  return <>{useAnimatedNumber(props)}</>;
}
