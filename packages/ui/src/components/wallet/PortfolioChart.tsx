import { cn } from "../../primitives/cn";

/**
 * The main screen's total-portfolio-value chart (wallet-main-screen.html's
 * chart + range-tabs block) — a hand-rolled SVG line/area chart rather
 * than a charting library, per this task's packet: "Given extension
 * bundle-size sensitivity, prefer a hand-rolled lightweight SVG chart over
 * pulling in a full charting library unless you find one already used
 * elsewhere in this codebase." No charting library appears anywhere in
 * this workspace's `pnpm-lock.yaml` — checked before choosing this
 * approach.
 *
 * Purely presentational: `points` is the already-fetched, already-priced
 * series (`PortfolioHistory.series`, via `@gleam/core`'s barrel), and the
 * caller (`MainScreenView`) owns fetching per range and the
 * loading/error states. Switching `activeRange` is the caller's
 * responsibility too — this component only renders the 5 tabs and reports
 * clicks via `onRangeChange`, so range/chart/%-change/period-label always
 * update together from one fetch rather than this component and its
 * caller disagreeing about which range is "current."
 *
 * Color rule (RELEVANT RULES, confirmed): reuses `--color-positive`
 * (already a Tailwind utility, `text-positive`/`border-positive`, per
 * `ActivityRow`/`AddressDisplay`'s existing usage) for gains. No
 * `--color-negative`/decline token exists yet in `packages/ui/src/tokens/
 * theme.css` — that file is outside this task's ALLOWED SCOPE (only
 * `packages/ui/src/components/wallet/**` is granted), so a new token
 * couldn't be added there; see this task's final report. Referenced here
 * as a raw CSS custom property via inline `style`, exactly like
 * `primitives/beam.tsx`'s `BeamMark` already does for
 * `var(--color-beam-*)` when no Tailwind utility exists for a color yet —
 * `--color-negative` needs adding to `theme.css`'s `@theme` block
 * (following `--color-positive`'s own comment style) by whoever owns that
 * file before this reference resolves to a real color; until then it
 * falls back to the browser's `currentColor` default via the `red`
 * fallback below, which is a placeholder, not a design decision.
 */
export interface PortfolioChartPoint {
  timestamp: number;
  usdValue: number;
}

export type PortfolioChartRange = "24H" | "7D" | "1M" | "1Y" | "ALL";

const RANGE_TABS: PortfolioChartRange[] = ["24H", "7D", "1M", "1Y", "ALL"];

export interface PortfolioChartProps {
  points: PortfolioChartPoint[];
  currentUsdValue: number;
  usdChange: number;
  periodLabel: string;
  activeRange: PortfolioChartRange;
  onRangeChange: (range: PortfolioChartRange) => void;
  loading?: boolean;
  className?: string;
}

const CHART_WIDTH = 100;
const CHART_HEIGHT = 40;

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

/** Maps a series to a `0..CHART_WIDTH x 0..CHART_HEIGHT` SVG polyline's points, flat-lining a single-point or zero-range series at the vertical midpoint rather than dividing by zero. */
function buildLinePath(points: PortfolioChartPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `0,${CHART_HEIGHT / 2} ${CHART_WIDTH},${CHART_HEIGHT / 2}`;
  }

  const minTimestamp = points[0]!.timestamp;
  const maxTimestamp = points[points.length - 1]!.timestamp;
  const timeRange = maxTimestamp - minTimestamp || 1;

  const values = points.map((point) => point.usdValue);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;

  return points
    .map((point) => {
      const x = ((point.timestamp - minTimestamp) / timeRange) * CHART_WIDTH;
      const y = CHART_HEIGHT - ((point.usdValue - minValue) / valueRange) * CHART_HEIGHT;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function PortfolioChart({
  points,
  currentUsdValue,
  usdChange,
  periodLabel,
  activeRange,
  onRangeChange,
  loading = false,
  className,
}: PortfolioChartProps) {
  const isPositive = usdChange >= 0;
  const linePoints = buildLinePath(points);
  const areaPoints = linePoints ? `0,${CHART_HEIGHT} ${linePoints} ${CHART_WIDTH},${CHART_HEIGHT}` : "";
  const lineColorVar = isPositive ? "var(--color-positive)" : "var(--color-negative, red)";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline gap-2">
        <span className="text-h3 font-semibold tabular-nums text-foreground">
          {loading ? "—" : formatUsd(currentUsdValue)}
        </span>
        <span
          className="text-label font-semibold tabular-nums"
          style={{ color: loading ? undefined : lineColorVar }}
        >
          {loading ? "" : formatPercent(usdChange)}
        </span>
      </div>
      <div className="text-caption text-muted">{loading ? "Loading…" : periodLabel}</div>

      <div className="h-[80px] w-full">
        {loading ? (
          <div className="h-full w-full animate-pulse rounded-md bg-line motion-reduce:animate-none motion-reduce:opacity-70" />
        ) : points.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center text-caption text-faint">
            No chart data
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            width="100%"
            height="100%"
            role="img"
            aria-label={`Portfolio value ${formatUsd(currentUsdValue)}, ${formatPercent(usdChange)} for ${periodLabel}`}
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
      </div>

      <div role="tablist" aria-label="Chart range" className="flex items-center gap-1">
        {RANGE_TABS.map((range) => (
          <button
            key={range}
            type="button"
            role="tab"
            aria-selected={range === activeRange}
            onClick={() => onRangeChange(range)}
            className={cn(
              "rounded-md px-2.5 py-1 text-caption font-semibold",
              range === activeRange
                ? "bg-foreground text-background"
                : "text-muted hover:bg-mist hover:text-foreground",
            )}
          >
            {range}
          </button>
        ))}
      </div>
    </div>
  );
}
