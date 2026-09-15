import { cn } from "../../primitives/cn";
import { TokenGlyph, type TokenGlyphProps } from "./TokenGlyph";

/**
 * A token balance row (wallet-main-screen.html's `.row` inside
 * `.list-card`, reused verbatim on the "all tokens" list and token
 * detail's activity section per TODO.md 4.1: "same row style as main
 * screen — no new visual language introduced just because it's a list
 * page"). Amount/usdValue are pre-formatted strings — this component
 * does no numeric formatting or unit conversion itself.
 *
 * Reuses the same row skeleton as `ListRow` (start/title-subtitle/end),
 * but stays a standalone component rather than composing `ListRow`
 * directly — `ListRow`'s title/subtitle stack puts the subtitle in
 * monospace (built for addresses), while a token row's amount subtitle
 * and right-aligned usdValue don't fit that shape.
 *
 * Left column is name over holding amount; right column is the
 * holding's dollar value.
 *
 * `loading` is for a background refresh of an already-rendered row (e.g.
 * a price re-poll) — it dims the existing usdValue in place rather than
 * tearing the row down to a shimmer skeleton, so a value that's already
 * on screen never disappears. First-ever load (nothing to show yet) is
 * still the caller swapping in `SkeletonRow` instead of mounting
 * `TokenRow` at all.
 */
export interface TokenRowProps {
  glyph: Pick<TokenGlyphProps, "label" | "tone">;
  name: string;
  amount: string;
  usdValue?: string;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

export function TokenRow({ glyph, name, amount, usdValue, loading = false, onClick, className }: TokenRowProps) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left last:border-b-0",
        onClick && "cursor-pointer hover:bg-mist",
        className,
      )}
    >
      <TokenGlyph {...glyph} />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="truncate text-label font-semibold text-foreground">{name}</div>
        <div className="text-caption tabular-nums text-muted">{amount}</div>
      </div>
      {usdValue ? (
        <div className={cn("shrink-0 text-label font-semibold tabular-nums text-foreground", loading && "opacity-50 transition-opacity")}>
          {usdValue}
        </div>
      ) : null}
    </Component>
  );
}
