import { formatPercent } from "../../format/currency";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DisplayCurrency, PortfolioScope } from "@gleam/core";
import { currencyStep, formatCurrencyParts, formatCurrencyValue, HIDDEN_AMOUNT, type CurrencyValueParts } from "../../format/currency";
import { animatedNumberTintStyle, useAnimatedNumber, type AnimatedNumberTrend } from "../../primitives/animated-number";
import { cn } from "../../primitives/cn";
import { NetworkErrorBanner } from "./NetworkErrorBanner";

/**
 * The main screen's total-portfolio-value chart — a hand-rolled SVG
 * line/area chart rather than a charting library, given extension
 * bundle-size sensitivity. No charting library appears anywhere in this
 * workspace's `pnpm-lock.yaml`.
 *
 * Purely presentational: `points` is the already-fetched, already-priced
 * series (`PortfolioHistory.series`, via `@gleam/core`'s barrel), and
 * the caller (`MainScreenView`) owns fetching per range and the
 * loading/error states. Switching `activeRange` is the caller's
 * responsibility too — this component only renders the 5 tabs and
 * reports clicks via `onRangeChange`, so range/chart/%-change/
 * period-label always update together from one fetch.
 *
 * `onRetry` (set by the caller when the active range's fetch failed)
 * swaps just the value/chart area for `NetworkErrorBanner` — the range
 * tabs always render regardless, so a failed range never strands the
 * user without a way to click back to a previously-cached range.
 *
 * Scope toggle: when the caller passes `onToggleScope` (only worth it with
 * more than one wallet), the chart area itself is the switch between the
 * active wallet's total and every wallet's. Nothing marks it at rest
 * beyond a pointer cursor. A click briefly crossfades the %-change to the
 * view now showing, so the note sits beside the figure it describes
 * rather than floating over the chart like a tooltip.
 *
 * Headline: the large figure is the total value unless the caller passes
 * `headline` (a token balance), which demotes the total to a smaller line
 * beside the %-change. `onToggleMasked` makes that figure a button that
 * hides or shows balances; `masked` swaps both figures for dots.
 *
 * `compact` moves the chart beside the figures as a small sparkline, which
 * leaves more of the popup for the token list.
 *
 * `loading` has nothing to show yet, so the chart shimmers. `refreshing`
 * has a cached figure on screen while it's read again: the figures dim
 * lightly if that takes over a moment, and the total ticks once to the new figure.
 *
 * Color rule: reuses `--color-positive` for gains and `--color-negative`
 * for losses — both real `@theme` tokens, never `--color-beam-red`/
 * `--color-beam-green` (identity-only). Referenced as raw CSS custom
 * properties via inline `style`/SVG `fill`/`stroke` since `isPositive`
 * picks the color dynamically per render, and SVG attributes need a
 * color value, not a class name.
 */
export interface PortfolioChartPoint {
  timestamp: number;
  value: number;
}

export type PortfolioChartRange = "24H" | "7D" | "1M" | "1Y" | "ALL";

const RANGE_TABS: PortfolioChartRange[] = ["24H", "7D", "1M", "1Y", "ALL"];

export interface PortfolioChartProps {
  points: PortfolioChartPoint[];
  currentValue: number;
  currency: DisplayCurrency;
  change: number;
  periodLabel: string;
  activeRange: PortfolioChartRange;
  onRangeChange: (range: PortfolioChartRange) => void;
  loading?: boolean;
  /**
   * The figures show restored data that fresh data hasn't replaced yet. They
   * render faded from the first frame, fade up when this goes false, and the
   * totals tick once at that switch. Keep it true until every input feeding
   * the total is fresh.
   */
  cached?: boolean;
  /** With `cached`: a live read is in flight, so the figures pulse; otherwise they rest at a still fade. */
  cachedFetching?: boolean;
  /** Tells this chart's figures apart across wallets; the range, scope and currency are added here. */
  walletKey?: string;
  /**
   * Set when the active range's fetch failed (thrown query error, or a
   * resolved-but-empty series). Replaces just the value/chart area with
   * `NetworkErrorBanner`; the range tabs below stay rendered regardless.
   */
  onRetry?: () => void;
  /** With `onRetry`: the retry is in flight, so the banner shows it's working. */
  retrying?: boolean;
  scope?: PortfolioScope;
  /** Makes the chart area toggle `scope`. Leave unset when there's only one wallet. */
  onToggleScope?: () => void;
  /**
   * Shown as the large figure in place of the total value, e.g.
   * `{ amount: "12.5", unit: "AR", value: 12.5 }`. `value` lets a change tick
   * over; without it the figure swaps.
   */
  headline?: CurrencyValueParts & { value?: number };
  masked?: boolean;
  onToggleMasked?: () => void;
  compact?: boolean;
  className?: string;
}

const CHART_WIDTH = 100;
const CHART_HEIGHT = 40;
/** Keeps the highest and lowest points off the box's edges, where half the stroke would be clipped flat. */
const CHART_INSET_Y = 3;

/**
 * Fed through the same `buildLinePath` used for real data — a gentle
 * hand-authored wave rather than a flat line, so the shimmer has a line
 * worth traveling along. Only for a zero-balance wallet; never alongside
 * real values.
 */
const EMPTY_STATE_POINTS: PortfolioChartPoint[] = [
  { timestamp: 0, value: 0.3 },
  { timestamp: 1, value: 0.55 },
  { timestamp: 2, value: 0.4 },
  { timestamp: 3, value: 0.7 },
  { timestamp: 4, value: 0.5 },
  { timestamp: 5, value: 0.8 },
  { timestamp: 6, value: 0.65 },
];

const SCOPE_FLASH_MS = 2500;

/** The toggle's accessible name, i.e. what a click does next. */
const SCOPE_ACTION_LABEL: Record<PortfolioScope, string> = {
  wallet: "Show all wallets",
  all: "Show this wallet",
};

const SCOPE_CONFIRMATION: Record<PortfolioScope, string> = {
  wallet: "This wallet",
  all: "All wallets",
};

/** Maps a series to a `0..CHART_WIDTH x 0..CHART_HEIGHT` SVG polyline's points, flat-lining a single-point or zero-range series at the vertical midpoint rather than dividing by zero. */
function buildLinePath(points: PortfolioChartPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `0,${CHART_HEIGHT / 2} ${CHART_WIDTH},${CHART_HEIGHT / 2}`;
  }

  const minTimestamp = points[0]!.timestamp;
  const maxTimestamp = points[points.length - 1]!.timestamp;
  const timeRange = maxTimestamp - minTimestamp || 1;

  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;

  return points
    .map((point) => {
      const x = ((point.timestamp - minTimestamp) / timeRange) * CHART_WIDTH;
      const y = CHART_HEIGHT - CHART_INSET_Y - ((point.value - minValue) / valueRange) * (CHART_HEIGHT - 2 * CHART_INSET_Y);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Enough to keep the trend's shape without packing several points into each pixel, which reads as a thick, jagged line. */
const SPARKLINE_POINTS = 32;
const CHART_POINTS = 90;

/**
 * Averages a series into `maxPoints` equal buckets, keeping the last
 * point exact so the line still ends on the current value.
 */
function downsample(points: PortfolioChartPoint[], maxPoints: number): PortfolioChartPoint[] {
  if (points.length <= maxPoints) return points;
  const bucketSize = points.length / (maxPoints - 1);
  const result: PortfolioChartPoint[] = [];
  for (let bucket = 0; bucket < maxPoints - 1; bucket++) {
    const slice = points.slice(Math.floor(bucket * bucketSize), Math.floor((bucket + 1) * bucketSize));
    if (slice.length === 0) continue;
    result.push({
      timestamp: slice[0]!.timestamp,
      value: slice.reduce((sum, point) => sum + point.value, 0) / slice.length,
    });
  }
  result.push(points[points.length - 1]!);
  return result;
}

export function PortfolioChart({
  points,
  currentValue,
  currency,
  change,
  periodLabel,
  activeRange,
  onRangeChange,
  loading = false,
  cached = false,
  cachedFetching = false,
  walletKey = "",
  onRetry,
  retrying,
  scope = "wallet",
  onToggleScope,
  headline,
  masked = false,
  onToggleMasked,
  compact = false,
  className,
}: PortfolioChartProps) {
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  // Keeps the scope text through its fade-out instead of blanking first.
  const lastFlashRef = useRef("");
  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

  const toggleScope = () => {
    if (!onToggleScope) return;
    const nextScope: PortfolioScope = scope === "all" ? "wallet" : "all";
    onToggleScope();
    setFlash(SCOPE_CONFIRMATION[nextScope]);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), SCOPE_FLASH_MS);
  };

  if (flash) lastFlashRef.current = flash;
  const isPositive = change >= 0;
  const isEmpty = currentValue === 0 && points.every((point) => point.value === 0);
  const linePoints = buildLinePath(downsample(points, compact ? SPARKLINE_POINTS : CHART_POINTS));
  const areaPoints = linePoints ? `0,${CHART_HEIGHT} ${linePoints} ${CHART_WIDTH},${CHART_HEIGHT}` : "";
  const lineColorVar = isPositive ? "var(--color-positive)" : "var(--color-negative)";
  const totalText = masked ? HIDDEN_AMOUNT : formatCurrencyValue(currentValue, currency);
  // Both run on every render so hook order holds; masked figures never show a frame.
  const totalParts = formatCurrencyParts(currentValue, currency);
  // While loading, `currentValue` is a stand-in, so the first real figure swaps in rather than ticking up from it.
  const figureIdentity = `${walletKey}|${activeRange}|${scope}|${currency}`;
  const total = useAnimatedNumber({
    value: loading ? Number.NaN : currentValue,
    text: totalParts.amount,
    format: (value) => formatCurrencyParts(value, currency).amount,
    step: currencyStep(currentValue, currency),
    identity: figureIdentity,
    cached,
  });
  const headlineFigure = useAnimatedNumber({
    value: headline?.value ?? Number.NaN,
    text: headline?.amount ?? "",
    identity: `${figureIdentity}|${headline?.unit ?? ""}`,
    cached,
  });
  const faded = cached && !loading;
  const totalLabel = masked ? HIDDEN_AMOUNT : totalParts.unit ? `${total.text} ${totalParts.unit}` : total.text;
  const headlineParts: CurrencyValueParts = masked
    ? { amount: HIDDEN_AMOUNT }
    : headline
      ? { amount: headlineFigure.text, unit: headline.unit }
      : { amount: total.text, unit: totalParts.unit };
  const headlineTrend = masked ? null : headline ? headlineFigure.trend : total.trend;
  // The range tabs already name the period, so the scope note briefly takes the %-change's place instead.
  const changeBadge = (
    <span className="grid text-label font-semibold tabular-nums">
      <span
        aria-hidden={flash ? true : undefined}
        className={cn("col-start-1 row-start-1 transition-opacity duration-300", flash && "opacity-0")}
        style={{ color: lineColorVar }}
      >
        {formatPercent(change)}
      </span>
      <span
        aria-live="polite"
        className={cn("col-start-1 row-start-1 whitespace-nowrap text-muted transition-opacity duration-300", !flash && "opacity-0")}
      >
        {flash ?? lastFlashRef.current}
      </span>
    </span>
  );

  const figures = (
    <div className={cn("flex min-w-0 flex-col gap-0.5 transition-opacity duration-500 ease-out", loading && "opacity-50", faded && (cachedFetching ? "gleam-cached-pulse" : "opacity-70"))}>
      <div className="flex items-baseline gap-2.5">
        <Headline parts={headlineParts} trend={headlineTrend} masked={masked} onToggle={onToggleMasked} />
        {headline === undefined ? changeBadge : null}
      </div>
      {headline !== undefined ? (
        <div className="flex items-baseline gap-2.5">
          <span className="text-label tabular-nums text-muted" style={animatedNumberTintStyle(masked ? null : total.trend)}>
            {totalLabel}
          </span>
          {changeBadge}
        </div>
      ) : null}
    </div>
  );

  const chart = (
    <ChartArea onToggle={onToggleScope ? toggleScope : undefined} scope={scope} compact={compact}>
      {loading ? (
        // Faded: a chart is mostly white, so a full-strength block is heavier than what replaces it.
        <div className="h-full w-full gleam-shimmer rounded-md opacity-60" />
      ) : points.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-caption text-faint">
          No chart data
        </div>
      ) : isEmpty ? (
        <EmptyLine />
      ) : (
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          role="img"
          aria-label={`Portfolio value ${totalText}, ${formatPercent(change)} for ${periodLabel}`}
        >
          {compact ? null : <polygon points={areaPoints} fill={lineColorVar} opacity={0.12} stroke="none" />}
          <polyline
            points={linePoints}
            fill="none"
            stroke={lineColorVar}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </ChartArea>
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {onRetry ? (
        <NetworkErrorBanner onRetry={onRetry} retrying={retrying} className="phone:mx-0 phone:mt-0" />
      ) : compact ? (
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">{figures}</div>
          {chart}
        </div>
      ) : (
        <>
          {figures}
          {chart}
          {isEmpty && <div className="text-center text-caption text-faint">Your portfolio value will appear here.</div>}
        </>
      )}

      <div role="tablist" aria-label="Chart range" className="flex items-center gap-1 phone:-mx-2.5">
        {RANGE_TABS.map((range) => (
          <button
            key={range}
            type="button"
            role="tab"
            aria-selected={range === activeRange}
            onClick={() => onRangeChange(range)}
            className={cn(
              "rounded-md px-2.5 py-1 text-caption font-semibold phone:hit-target",
              range === activeRange
                ? "bg-mist text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {range}
          </button>
        ))}
      </div>
    </div>
  );
}

const HEADLINE_CLASS = "text-[36px] font-semibold tracking-[-0.02em] tabular-nums text-foreground";

/** The large figure; a button that hides or shows balances when `onToggle` is set. */
function Headline({ parts, trend, masked, onToggle }: { parts: CurrencyValueParts; trend: AnimatedNumberTrend | null; masked: boolean; onToggle?: () => void }) {
  const label = (
    <>
      <span style={animatedNumberTintStyle(trend)}>{parts.amount}</span>
      {parts.unit ? (
        <>
          {" "}
          <span className="text-h3 tracking-normal">{parts.unit}</span>
        </>
      ) : null}
    </>
  );
  if (!onToggle) return <span className={HEADLINE_CLASS}>{label}</span>;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={masked}
      aria-label={masked ? "Show balances" : "Hide balances"}
      title={masked ? "Show balances" : "Hide balances"}
      className={cn(HEADLINE_CLASS, "-mx-1 cursor-pointer rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-foreground")}
    >
      {label}
    </button>
  );
}

const EMPTY_LINE = buildLinePath(EMPTY_STATE_POINTS);

/** The empty chart: a faint beam-tinted wave with a light traveling along it. */
function EmptyLine() {
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="No portfolio history yet"
    >
      <defs>
        <linearGradient id="portfolio-chart-empty-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={CHART_WIDTH} y2="0">
          <stop offset="0%" stopColor="var(--color-beam-purple)" />
          <stop offset="35%" stopColor="var(--color-beam-sky)" />
          <stop offset="70%" stopColor="var(--color-beam-yellow)" />
          <stop offset="100%" stopColor="var(--color-beam-green)" />
        </linearGradient>
      </defs>
      <polyline
        points={EMPTY_LINE}
        fill="none"
        stroke="url(#portfolio-chart-empty-gradient)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity={0.13}
      />
      <polyline
        className="gleam-chart-empty-shimmer"
        points={EMPTY_LINE}
        fill="none"
        stroke="url(#portfolio-chart-empty-gradient)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={100}
      />
    </svg>
  );
}

interface ChartAreaProps {
  onToggle?: () => void;
  scope: PortfolioScope;
  compact: boolean;
  children: ReactNode;
}

/** The chart slot, full width or a sparkline beside the figures: a plain box, or a button over it when the scope toggle is enabled. */
function ChartArea({ onToggle, scope, compact, children }: ChartAreaProps) {
  const size = compact ? "h-8 w-32 flex-shrink-0" : "h-16 w-full phone:[@media(max-height:700px)]:h-12";
  if (!onToggle) return <div className={size}>{children}</div>;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={scope === "all"}
      aria-label={SCOPE_ACTION_LABEL[scope]}
      className={cn(
        size,
        "block cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
      )}
    >
      {children}
    </button>
  );
}
