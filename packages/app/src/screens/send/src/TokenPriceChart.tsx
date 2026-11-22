import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { priceSourceForProcessId, type DisplayCurrency, type PortfolioHistoryRange, type RuntimePort } from "@gleam/core";
import { buildLinePath, chartCoordinates, CHART_HEIGHT, CHART_WIDTH, downsample, type ChartPoint } from "@gleam/ui/src/components/wallet/chart-path.ts";
import { formatCurrencyValue, formatPercent } from "@gleam/ui/src/format/currency.ts";
import { rangeTabClass } from "@gleam/ui/src/components/wallet/index.ts";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { useLocale, useT } from "../../../i18n";
import { useTokenPriceHistory } from "./useTokenPriceHistory";

const RANGES: PortfolioHistoryRange[] = ["24H", "7D", "1M", "1Y", "ALL"];
const CHART_POINTS = 90;

/** A day's points differ by the hour, a year's by the day. */
const DATE_FORMATS: Record<PortfolioHistoryRange, Intl.DateTimeFormatOptions> = {
  "24H": { weekday: "short", hour: "numeric", minute: "2-digit" },
  "7D": { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  "1M": { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  "1Y": { month: "short", day: "numeric", year: "numeric" },
  ALL: { month: "short", day: "numeric", year: "numeric" },
};

/** Only a token with a market price listing has a history; every other token gets no chart at all. */
export function hasPriceHistory(processId: string | null): boolean {
  return processId === null || priceSourceForProcessId(processId) !== null;
}

/**
 * The token details price chart. At rest the figures show the latest price
 * and the move over the range; dragging or hovering across the line shows
 * the price and date under the pointer. Renders nothing when the range has
 * no series to draw.
 */
export function TokenPriceChart({
  runtime,
  processId,
  currency,
}: {
  runtime: RuntimePort;
  processId: string | null;
  currency: DisplayCurrency;
}) {
  const t = useT();
  const locale = useLocale();
  const [range, setRange] = useState<PortfolioHistoryRange>("7D");
  const [active, setActive] = useState<number | null>(null);
  const query = useTokenPriceHistory(runtime, processId, range, currency);

  if (query.isPending) {
    return <div className="h-[132px] w-full gleam-shimmer rounded-md opacity-60" />;
  }
  const series = query.data?.series ?? [];
  if (series.length < 2) return null;

  const points = downsample(series, CHART_POINTS);
  const coordinates = chartCoordinates(points);
  const first = points[0]!.value;
  const last = points[points.length - 1]!;
  const change = first > 0 ? last.value / first - 1 : 0;
  const lineColor = change >= 0 ? "var(--color-chart-line-up)" : "var(--color-chart-line-down)";
  const linePath = buildLinePath(points);
  const shown: ChartPoint = active === null ? last : points[active]!;
  const shownAt = active === null ? null : coordinates[active]!;
  const dateText = new Intl.DateTimeFormat(locale, DATE_FORMATS[range]).format(shown.timestamp);

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const x = ((event.clientX - box.left) / box.width) * CHART_WIDTH;
    let nearest = 0;
    for (let index = 1; index < coordinates.length; index++) {
      if (Math.abs(coordinates[index]!.x - x) < Math.abs(coordinates[nearest]!.x - x)) nearest = index;
    }
    setActive(nearest);
  };

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? points.length - 1) + delta)));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2.5" aria-live="polite">
        <span className="text-h3 font-semibold tabular-nums text-foreground">{formatCurrencyValue(shown.value, currency, locale)}</span>
        {active === null ? (
          <span className="text-label font-semibold tabular-nums" style={{ color: lineColor }}>
            {formatPercent(change, locale)}
          </span>
        ) : (
          <span className="text-label tabular-nums text-muted">{dateText}</span>
        )}
      </div>

      <div
        role="img"
        tabIndex={0}
        aria-label={t("send.priceChart")}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={step}
        className={cn(
          "relative h-24 w-full touch-pan-y rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          query.isPlaceholderData && "opacity-50",
        )}
      >
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
          <polygon className="silica:hidden" points={`0,${CHART_HEIGHT} ${linePath} ${CHART_WIDTH},${CHART_HEIGHT}`} fill={lineColor} opacity={0.12} stroke="none" />
          <polyline
            points={linePath}
            fill="none"
            stroke={lineColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {shownAt ? (
          <>
            {/* Drawn outside the stretched SVG, which would squash the dot into an ellipse. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-line"
              style={{ left: `${(shownAt.x / CHART_WIDTH) * 100}%` }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
              style={{ left: `${(shownAt.x / CHART_WIDTH) * 100}%`, top: `${(shownAt.y / CHART_HEIGHT) * 100}%`, background: lineColor }}
            />
          </>
        ) : null}
      </div>

      <div role="tablist" aria-label={t("common.chartRange")} className="flex items-center gap-1 phone:-mx-2.5">
        {RANGES.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={option === range}
            onClick={() => {
              setRange(option);
              setActive(null);
            }}
            className={rangeTabClass(option === range)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
