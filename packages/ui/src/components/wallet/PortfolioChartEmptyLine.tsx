import { useUiLabels } from "../../labels";
import { buildLinePath, CHART_HEIGHT, CHART_WIDTH, type ChartPoint } from "./chart-path";

/**
 * Fed through the same `buildLinePath` used for real data — a gentle
 * hand-authored wave rather than a flat line, so the shimmer has a line
 * worth traveling along. Only for a zero-balance wallet; never alongside
 * real values.
 */
const EMPTY_STATE_POINTS: ChartPoint[] = [
  { timestamp: 0, value: 0.3 },
  { timestamp: 1, value: 0.55 },
  { timestamp: 2, value: 0.4 },
  { timestamp: 3, value: 0.7 },
  { timestamp: 4, value: 0.5 },
  { timestamp: 5, value: 0.8 },
  { timestamp: 6, value: 0.65 },
];

const EMPTY_LINE = buildLinePath(EMPTY_STATE_POINTS);

/** The empty chart: a faint beam-tinted wave with a light traveling along it. */
export function PortfolioChartEmptyLine() {
  const labels = useUiLabels();
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label={labels.chart.noHistory}
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
