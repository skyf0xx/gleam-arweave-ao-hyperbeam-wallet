import { cn } from "../../primitives/cn";
import { TokenGlyph, type TokenGlyphProps } from "./TokenGlyph";

/**
 * A token balance row (wallet-main-screen.html's `.row` inside
 * `.list-card`, reused verbatim on the "all tokens" list and token
 * detail's activity section per TODO.md 4.1: "same row style as main
 * screen — no new visual language introduced just because it's a list
 * page"). Amount/usdValue are pre-formatted strings — this component
 * does no numeric formatting or unit conversion itself.
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
        "flex w-full items-center gap-2.5 border-b border-[#e5e5e5] py-2.5 text-left last:border-b-0",
        onClick && "cursor-pointer hover:bg-[#f5f5f5]",
        className,
      )}
    >
      <TokenGlyph {...glyph} />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="truncate text-[13px] font-semibold text-[#111111]">{name}</div>
        <div className="text-[11px] text-[#737373]">{ticker}</div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-px">
        <div className="text-[13px] font-semibold tabular-nums text-[#111111]">{amount}</div>
        {usdValue ? <div className="text-[11px] tabular-nums text-[#a3a3a3]">{usdValue}</div> : null}
      </div>
    </Component>
  );
}
