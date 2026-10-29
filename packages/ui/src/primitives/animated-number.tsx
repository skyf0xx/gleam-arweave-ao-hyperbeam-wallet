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
   * What the figure is: wallet, range, scope, currency and so on. A tick
   * only compares like with like, so a new identity swaps to the new text
   * (ticking a dollar figure through a euro format would show amounts that
   * were never true).
   */
  identity: string;
  /**
   * True while `value` still comes from restored data. The figure ticks
   * once, when `cached` goes from true to false under the same `identity`.
   * Keep it true until every input feeding `value` is fresh.
   */
  cached: boolean;
}

/**
 * Returns what to show for `value`: `text`, or on the cached-to-live
 * switch, frames ticking from the cached figure to the live one. The first
 * value, a new `identity`, a live-to-live change, a change under 1%, a
 * reduced-motion preference, or a `text` with no `format` for its frames
 * swaps straight to the new text.
 */
export function useAnimatedNumber({ value, text, format, identity, cached }: AnimatedNumberProps): string {
  const [frame, setFrame] = useState<string | null>(null);
  const shownRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const previousRef = useRef({ identity, cached });
  const formatRef = useRef(format);
  formatRef.current = format;

  useLayoutEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { identity, cached };
    const from = previous.identity === identity && previous.cached && !cached ? shownRef.current : null;
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
      setFrame(formatFrame(from + (value - from) * easeOutQuart(progress)));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return cancel;
    // `text` follows `value`; only a new figure, identity or cached flip starts a tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, identity, cached]);

  return frame ?? text;
}

/** `useAnimatedNumber` as an inline element. */
export function AnimatedNumber(props: AnimatedNumberProps) {
  return <>{useAnimatedNumber(props)}</>;
}
