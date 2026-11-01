import type { ReactNode } from "react";
import { cn } from "../../primitives/cn";
import { formatPercent } from "../../format/currency";
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
 * `loading` is for a background refresh of an already-rendered row (e.g.
 * a cached balance being read again) — it dims the existing figures in
 * place rather than tearing the row down to a shimmer skeleton, so a
 * value that's already on screen never disappears. First-ever load is
 * still the caller swapping in `SkeletonRow` instead of mounting
 * `TokenRow` at all.
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
  loading?: boolean;
  /** Shows restored data that fresh data hasn't replaced yet: faded from the first frame, fading up once it lands. */
  cached?: boolean;
  /** With `cached`: the live read is in flight, so the figures pulse; otherwise they rest at a still fade. */
  cachedFetching?: boolean;
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

export function TokenRow({ glyph, icon, name, amount, amountFull, value, unitPrice, change, loading = false, cached = false, cachedFetching = false, onClick, className }: TokenRowProps) {
  const Component = onClick ? "button" : "div";
  const priced = unitPrice ? ` @ ${unitPrice}` : null;
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left last:border-b-0 phone:gap-3 phone:border-b-0 phone:px-0 phone:py-3.5 phone:[@media(max-height:700px)]:py-3",
        onClick && "cursor-pointer hover:bg-mist phone:active:bg-mist",
        className,
      )}
    >
      {icon ?? <TokenGlyph {...glyph} />}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="truncate text-label font-semibold text-foreground">{name}</div>
        <div className={cn("text-caption tabular-nums text-muted transition-opacity duration-500 ease-out", loading && "opacity-50", cached && !loading && (cachedFetching ? "gleam-cached-pulse" : "opacity-70"))} title={amountFull}>
          {amountFull ? (
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
        <div className={cn("shrink-0 text-right text-label font-semibold tabular-nums text-foreground", "transition-opacity duration-500 ease-out", loading && "opacity-50", cached && !loading && (cachedFetching ? "gleam-cached-pulse" : "opacity-70"), "phone:group-data-editing:invisible")}>
          {value}
          {change === undefined ? null : <ChangeLine change={change} />}
        </div>
      ) : null}
    </Component>
  );
}
