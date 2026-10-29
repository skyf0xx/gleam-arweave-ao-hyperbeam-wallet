import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** The sweep toward the target, drawn at a rate the eye can follow. */
const SWEEP_MS = 650;
const SWEEP_FRAME_MS = 66;
/** Gaps before each of the last three steps of the final digit: the figure settles rather than stops. */
const SETTLE_GAPS_MS = [90, 160, 260] as const;
export const ANIMATED_NUMBER_DURATION_MS = SWEEP_MS + SETTLE_GAPS_MS.reduce((sum, gap) => sum + gap, 0);
/** How long a landed figure stays tinted before it fades back. */
export const ANIMATED_NUMBER_TINT_MS = 200;
const TINT_FADE_MS = 900;

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

/** The value of one step of `text`'s last digit, for a plain decimal. */
function plainDecimalStep(text: string): number | undefined {
  const match = PLAIN_DECIMAL.exec(text);
  return match ? 10 ** -(match[1]?.length ?? 0) : undefined;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export type AnimatedNumberTrend = "up" | "down";

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
   * One step of the last digit `format` shows, such as 0.01 for cents. The
   * last steps land slowly so the eye sees where the figure settles.
   * Defaults to `text`'s last decimal place for a plain decimal; without
   * one the sweep runs straight to the end.
   */
  step?: number;
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

export interface AnimatedFigure {
  text: string;
  /** Which way the figure just ticked, for a brief tint once it lands. */
  trend: AnimatedNumberTrend | null;
}

/**
 * Returns what to show for `value`: `text`, or on the cached-to-live
 * switch, frames ticking from the cached figure to the live one. The first
 * value, a new `identity`, a live-to-live change, a change under 1%, a
 * reduced-motion preference, or a `text` with no `format` for its frames
 * swaps straight to the new text.
 */
export function useAnimatedNumber({ value, text, format, step, identity, cached }: AnimatedNumberProps): AnimatedFigure {
  const [frame, setFrame] = useState<string | null>(null);
  const [trend, setTrend] = useState<AnimatedNumberTrend | null>(null);
  const shownRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const previousRef = useRef({ identity, cached });
  const formatRef = useRef(format);
  formatRef.current = format;
  const stepRef = useRef(step);
  stepRef.current = step;

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
    setTrend(null);
    if (from === null || from === value || !Number.isFinite(from) || !Number.isFinite(value) || !formatFrame || prefersReducedMotion() || Math.abs(value - from) / Math.max(Math.abs(from), TINY) < MIN_TICK_CHANGE) {
      shownRef.current = value;
      setFrame(null);
      return;
    }

    const direction = Math.sign(value - from);
    const unit = stepRef.current ?? plainDecimalStep(text);
    // The settle steps must sit between the two figures, or the tick would overshoot.
    const settle = unit !== undefined && Math.abs(value - from) > (SETTLE_GAPS_MS.length + 1) * unit
      ? SETTLE_GAPS_MS.map((_, index) => value - direction * (SETTLE_GAPS_MS.length - 1 - index) * unit)
      : [];
    const sweepTo = settle.length > 0 ? value - direction * SETTLE_GAPS_MS.length * unit! : value;
    const settleAt = SETTLE_GAPS_MS.reduce<number[]>((at, gap) => [...at, (at.at(-1) ?? SWEEP_MS) + gap], []);
    const end = settle.length > 0 ? settleAt.at(-1)! : SWEEP_MS;

    setFrame(formatFrame(from));
    let start: number | null = null;
    let lastPaint = 0;
    const tick = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      if (elapsed >= end) {
        rafRef.current = null;
        shownRef.current = value;
        setFrame(null);
        setTrend(direction > 0 ? "up" : "down");
        return;
      }
      if (elapsed < SWEEP_MS) {
        if (elapsed - lastPaint >= SWEEP_FRAME_MS) {
          lastPaint = elapsed;
          setFrame(formatFrame(from + (sweepTo - from) * easeOutCubic(elapsed / SWEEP_MS)));
        }
      } else {
        const landed = settleAt.filter((at) => elapsed >= at).length - 1;
        setFrame(formatFrame(landed < 0 ? sweepTo : settle[landed]!));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return cancel;
    // `text` follows `value`; only a new figure, identity or cached flip starts a tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, identity, cached]);

  useEffect(() => {
    if (trend === null) return;
    const timer = window.setTimeout(() => setTrend(null), ANIMATED_NUMBER_TINT_MS);
    return () => window.clearTimeout(timer);
  }, [trend]);

  return { text: frame ?? text, trend };
}

/** Colours a figure by its trend: snaps to the tint on landing, then fades back. */
export function animatedNumberTintStyle(trend: AnimatedNumberTrend | null): CSSProperties {
  if (trend === null) return { transition: `color ${TINT_FADE_MS}ms ease-out` };
  return { color: trend === "up" ? "var(--color-positive)" : "var(--color-negative)", transition: "none" };
}

/** `useAnimatedNumber` as an inline element. */
export function AnimatedNumber(props: AnimatedNumberProps) {
  const { text, trend } = useAnimatedNumber(props);
  return <span style={animatedNumberTintStyle(trend)}>{text}</span>;
}
