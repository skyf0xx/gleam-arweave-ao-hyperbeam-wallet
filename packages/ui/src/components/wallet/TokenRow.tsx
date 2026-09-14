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
 * monospace (built for addresses), while a token row's ticker subtitle
 * and right-aligned two-line amount/usdValue don't fit that shape.
 */
export interface TokenRowProps {
  glyph: Pick<TokenGlyphProps, "label" | "tone">;
  name: string;
  ticker: string;
  amount: string;
  usdValue?: string;
  onClick?: () => void;
  className?: string;
}

export function TokenRow({ glyph, name, ticker, amount, usdValue, onClick, className }: TokenRowProps) {
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
        <div className="text-caption text-muted">{ticker}</div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-px">
        <div className="text-label font-semibold tabular-nums text-foreground">{amount}</div>
        {usdValue ? <div className="text-caption tabular-nums text-faint">{usdValue}</div> : null}
      </div>
    </Component>
  );
}
