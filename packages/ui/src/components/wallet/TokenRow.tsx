import type { ReactNode } from "react";
import { cn } from "../../primitives/cn";
import { useFreshAfterCache } from "../../primitives/loading-bar";
import { formatPercent } from "../../format/currency";
import { FigurePlaceholder } from "./FigurePlaceholder";
import { TokenGlyph, type TokenGlyphProps } from "./TokenGlyph";

/**
 * A token balance row, reused verbatim on the "all tokens" list and
 * token detail's activity section — same row style everywhere, no new
 * visual language just because it's a list page. Amount/value are
 * pre-formatted strings — this component does no numeric formatting or
 * unit conversion itself.
 *
 * Reuses the same row skeleton as `ListRow` (start/title-subtitle/end),
 * but stays a standalone component rather than composing `ListRow`
 * directly — `ListRow`'s title/subtitle stack puts the subtitle in
 * monospace (built for addresses), while a token row's amount subtitle
 * and right-aligned value don't fit that shape.
 *
 * Left column is name over holding amount; right column is the
 * holding's value in the display currency.
 *
 * Figures never dim. A cached figure shows at full strength while it is
 * read again (`cached`) and settles once when the fresh one lands.
 * `loading` means the figure has never been read: the amount and value
 * shimmer in place of their stand-ins, so no made-up 0 shows.
 */
export interface TokenRowProps {
  glyph: Pick<TokenGlyphProps, "label" | "tone" | "logoUrl">;
  /**
   * Replaces the ticker glyph, for a row that isn't a token (the Gleam
   * Points row). `glyph.label` still names the row for tests and snapshots.
   */
  icon?: ReactNode;
  name: string;
  /** A formatted string. It swaps in place; only the portfolio total ticks. */
  amount: ReactNode;
  /**
   * The unabbreviated amount when `amount` is shortened ("1.2K"). Shown on
   * hover and read by screen readers in place of the short form.
   */
  amountFull?: string;
  value?: ReactNode;
  /** The formatted price of one token, shown after the amount as `amount @ price`. */
  unitPrice?: string;
  /** Fractional 24-hour price move, under `value`. Left out when unknown, never shown as 0%. */
  change?: number;
  /** Nothing read yet: the figures shimmer in place of `amount` and `value`. */
  loading?: boolean;
  /** Shows restored data that fresh data hasn't replaced yet. It renders as-is; the figures settle once when this goes false. */
  cached?: boolean;
  onClick?: () => void;
  className?: string;
}

function ChangeLine({ change }: { change: number }) {
  return (
    <div className="text-caption font-normal" style={{ color: change >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}>
      {formatPercent(change)}
    </div>
  );
}

export function TokenRow({ glyph, icon, name, amount, amountFull, value, unitPrice, change, loading = false, cached = false, onClick, className }: TokenRowProps) {
  const Component = onClick ? "button" : "div";
  const fresh = useFreshAfterCache(cached);
  const priced = unitPrice ? ` @ ${unitPrice}` : null;
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "gleam-token-card flex w-full items-center gap-2.5 rounded-lg border-b border-line px-3.5 py-3 text-left last:border-b-0 phone:-mx-3 phone:w-[calc(100%+1.5rem)] phone:gap-3 phone:border-b-0 phone:px-3 phone:py-3.5 phone:[@media(max-height:700px)]:py-3",
        onClick && "cursor-pointer hover:bg-hover phone:active:bg-hover",
        className,
      )}
    >
      {icon ?? <TokenGlyph {...glyph} />}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="truncate text-label font-semibold text-foreground">{name}</div>
        <div className={cn("text-caption tabular-nums text-muted", fresh && !loading && "gleam-fresh")} title={loading ? undefined : amountFull}>
          {loading ? (
            <FigurePlaceholder>{amount}</FigurePlaceholder>
          ) : amountFull ? (
            <>
              <span aria-hidden="true" className="phone:hidden">
                {amount}
                {priced}
              </span>
              {/* A touch screen has no hover to reveal the full figure, so the phone has room to show it outright. */}
              <span className="sr-only phone:not-sr-only phone:block phone:truncate">{amountFull}{priced}</span>
            </>
          ) : (
            <>
              {amount}
              {priced}
            </>
          )}
        </div>
      </div>
      {value ? (
        <div className={cn("shrink-0 text-right text-label font-semibold tabular-nums text-foreground", fresh && !loading && "gleam-fresh", "phone:group-data-editing:invisible")}>
          {loading ? <FigurePlaceholder>{value}</FigurePlaceholder> : value}
          {change === undefined || loading ? null : <ChangeLine change={change} />}
        </div>
      ) : null}
    </Component>
  );
}
