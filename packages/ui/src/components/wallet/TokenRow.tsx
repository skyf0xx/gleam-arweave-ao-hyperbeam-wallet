import type { ReactNode } from "react";
import { cn } from "../../primitives/cn";
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
  loading?: boolean;
  /** A cached figure is being read again for long enough to notice: a light dim, not the `loading` one. */
  refreshing?: boolean;
  onClick?: () => void;
  className?: string;
}

export function TokenRow({ glyph, icon, name, amount, amountFull, value, loading = false, refreshing = false, onClick, className }: TokenRowProps) {
  const Component = onClick ? "button" : "div";
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
        <div className={cn("text-caption tabular-nums text-muted transition-opacity", loading && "opacity-50", refreshing && !loading && "opacity-85 duration-300")} title={amountFull}>
          {amountFull ? (
            <>
              <span aria-hidden="true" className="phone:hidden">
                {amount}
              </span>
              {/* A touch screen has no hover to reveal the full figure, so the phone has room to show it outright. */}
              <span className="sr-only phone:not-sr-only phone:block phone:truncate">{amountFull}</span>
            </>
          ) : (
            amount
          )}
        </div>
      </div>
      {value ? (
        <div className={cn("shrink-0 text-label font-semibold tabular-nums text-foreground", "transition-opacity", loading && "opacity-50", refreshing && !loading && "opacity-85 duration-300", "phone:group-data-editing:invisible")}>
          {value}
        </div>
      ) : null}
    </Component>
  );
}
