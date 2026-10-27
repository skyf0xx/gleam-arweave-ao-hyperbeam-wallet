import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DisplayCurrency, PortfolioScope } from "@gleam/core";
import { formatCurrencyParts, formatCurrencyValue, HIDDEN_AMOUNT, type CurrencyValueParts } from "../../format/currency";
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
 * beyond a pointer cursor. A click briefly crossfades the period caption
 * to the view now showing, so the label sits under the figure it
 * describes rather than floating over the chart like a tooltip.
 *
 * Headline: the large figure is the total value unless the caller passes
 * `headline` (a token balance), which demotes the total to a smaller line
 * beside the %-change. `onToggleMasked` makes that figure a button that
 * hides or shows balances; `masked` swaps both figures for dots.
 * `showChart: false` drops the chart and range tabs and keeps the figures,
 * moving the %-change down beside the period it covers.
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
   * Set when the active range's fetch failed (thrown query error, or a
   * resolved-but-empty series). Replaces just the value/chart area with
   * `NetworkErrorBanner`; the range tabs below stay rendered regardless.
   */
  onRetry?: () => void;
  scope?: PortfolioScope;
  /** Makes the chart area toggle `scope`. Leave unset when there's only one wallet. */
  onToggleScope?: () => void;
  /** Shown as the large figure in place of the total value, e.g. `{ amount: "12.5", unit: "AR" }`. */
  headline?: CurrencyValueParts;
  masked?: boolean;
  onToggleMasked?: () => void;
  showChart?: boolean;
  className?: string;
}

const CHART_WIDTH = 100;
const CHART_HEIGHT = 40;

/**
 * Fed through the same `buildLinePath` used for real data, so the
 * zero-balance empty state renders via the identical polyline/area code
 * path as a priced series — a gentle hand-authored wave rather than a
 * flat line, so the shimmer treatment below has a line worth traveling
 * along. Never shown alongside real values.
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

const PERCENT_FORMAT = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

function formatPercent(fraction: number): string {
  return PERCENT_FORMAT.format(fraction);
}

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
      const y = CHART_HEIGHT - ((point.value - minValue) / valueRange) * CHART_HEIGHT;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
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
  onRetry,
  scope = "wallet",
  onToggleScope,
  headline,
  masked = false,
  onToggleMasked,
  showChart = true,
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
  const linePoints = buildLinePath(isEmpty ? EMPTY_STATE_POINTS : points);
  const areaPoints = linePoints ? `0,${CHART_HEIGHT} ${linePoints} ${CHART_WIDTH},${CHART_HEIGHT}` : "";
  const lineColorVar = isPositive ? "var(--color-positive)" : "var(--color-negative)";
  const totalLabel = masked ? HIDDEN_AMOUNT : formatCurrencyValue(currentValue, currency);
  const headlineParts: CurrencyValueParts = masked ? { amount: HIDDEN_AMOUNT } : (headline ?? formatCurrencyParts(currentValue, currency));
  const changeBadge = (
    <span className="text-label font-semibold tabular-nums" style={{ color: lineColorVar }}>
      {formatPercent(change)}
    </span>
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {onRetry ? (
        <NetworkErrorBanner onRetry={onRetry} className="phone:mx-0 phone:mt-0" />
      ) : (
        <>
          <div className={cn("flex flex-col gap-0.5", loading && "opacity-50 transition-opacity")}>
            <div className="flex items-baseline gap-2.5">
              <Headline parts={headlineParts} masked={masked} onToggle={onToggleMasked} />
              {headline === undefined && showChart ? changeBadge : null}
            </div>
            {headline !== undefined ? (
              <div className="flex items-baseline gap-2.5">
                <span className="text-label tabular-nums text-muted">{totalLabel}</span>
                {showChart ? changeBadge : null}
              </div>
            ) : null}
            <div className="flex items-baseline gap-2">
              {showChart ? null : changeBadge}
              <div className="grid text-caption text-muted">
                <span
                  aria-hidden={flash ? true : undefined}
                  className={cn("col-start-1 row-start-1 transition-opacity duration-300", flash && "opacity-0")}
                >
                  {periodLabel || " "}
                </span>
                <span
                  aria-live="polite"
                  className={cn("col-start-1 row-start-1 transition-opacity duration-300", !flash && "opacity-0")}
                >
                  {flash ?? lastFlashRef.current}
                </span>
              </div>
            </div>
          </div>

          {showChart ? (
            <ChartArea
              onToggle={onToggleScope ? toggleScope : undefined}
              scope={scope}
            >
              {loading ? (
                <div className="h-full w-full gleam-shimmer rounded-md" />
              ) : points.length === 0 ? (
                <div className="flex h-full w-full items-center justify-center text-caption text-faint">
                  No chart data
                </div>
              ) : isEmpty ? (
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
                    points={linePoints}
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
                    points={linePoints}
                    fill="none"
                    stroke="url(#portfolio-chart-empty-gradient)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    pathLength={100}
                  />
                </svg>
              ) : (
                <svg
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  preserveAspectRatio="none"
                  width="100%"
                  height="100%"
                  role="img"
                  aria-label={`Portfolio value ${totalLabel}, ${formatPercent(change)} for ${periodLabel}`}
                >
                  <polygon points={areaPoints} fill={lineColorVar} opacity={0.12} stroke="none" />
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
          ) : null}
          {showChart && isEmpty && <div className="text-center text-caption text-faint">Your portfolio value will appear here.</div>}
        </>
      )}

      {showChart ? (
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
                  ? "bg-foreground text-background"
                  : "text-muted hover:bg-mist hover:text-foreground",
              )}
            >
              {range}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const HEADLINE_CLASS = "text-[36px] font-semibold tracking-[-0.02em] tabular-nums text-foreground";

/** The large figure; a button that hides or shows balances when `onToggle` is set. */
function Headline({ parts, masked, onToggle }: { parts: CurrencyValueParts; masked: boolean; onToggle?: () => void }) {
  const label = (
    <>
      {parts.amount}
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

interface ChartAreaProps {
  onToggle?: () => void;
  scope: PortfolioScope;
  children: ReactNode;
}

/** The 80px chart slot: a plain box, or a button over it when the scope toggle is enabled. */
function ChartArea({ onToggle, scope, children }: ChartAreaProps) {
  if (!onToggle) return <div className="h-[80px] w-full phone:[@media(max-height:700px)]:h-14">{children}</div>;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={scope === "all"}
      aria-label={SCOPE_ACTION_LABEL[scope]}
      className="block h-[80px] w-full cursor-pointer rounded-md text-left phone:[@media(max-height:700px)]:h-14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    >
      {children}
    </button>
  );
}
