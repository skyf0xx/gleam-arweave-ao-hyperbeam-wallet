import { type CurrencyValueParts } from "../../format/currency";
import { animatedNumberTintStyle, type AnimatedNumberTrend } from "../../primitives/animated-number";
import { cn } from "../../primitives/cn";
import { useUiLabels } from "../../labels";
import { FigurePlaceholder } from "./FigurePlaceholder";

const HEADLINE_CLASS = "gleam-figure text-display font-semibold dark:font-medium tracking-[-0.02em] tabular-nums text-foreground";

/** The large figure; a button that hides or shows balances when `onToggle` is set. */
export function PortfolioChartHeadline({ parts, trend, masked, onToggle, placeholder = false }: { parts: CurrencyValueParts; trend: AnimatedNumberTrend | null; masked: boolean; onToggle?: () => void; placeholder?: boolean }) {
  const labels = useUiLabels();
  const toggleLabel = masked ? labels.chart.showBalances : labels.chart.hideBalances;
  if (placeholder) {
    return (
      <span className={HEADLINE_CLASS}>
        <FigurePlaceholder>{parts.unit ? `${parts.amount} ${parts.unit}` : parts.amount}</FigurePlaceholder>
      </span>
    );
  }
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
      aria-label={toggleLabel}
      title={toggleLabel}
      className={cn(HEADLINE_CLASS, "-mx-1 cursor-pointer rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-foreground")}
    >
      {label}
    </button>
  );
}
