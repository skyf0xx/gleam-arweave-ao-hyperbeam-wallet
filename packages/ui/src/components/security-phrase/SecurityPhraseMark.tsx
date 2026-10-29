import type { SecurityPhrase } from "@gleam/core";
import { cn } from "../../primitives/cn";
import { SecurityPhraseIcon } from "./SecurityPhraseIcon";

export interface SecurityPhraseMarkProps {
  phrase: SecurityPhrase;
  /** The icon drawn from the phrase's word. */
  iconSvg: string;
  /** `stacked` greets the user on the unlock screen; `inline` sits in a header or a settings row. */
  layout?: "stacked" | "inline";
  className?: string;
}

/**
 * The user's anti-phishing phrase. Gleam's own screens show it; a window
 * drawn by a web page can't, so its absence is the warning sign.
 */
export function SecurityPhraseMark({ phrase, iconSvg, layout = "inline", className }: SecurityPhraseMarkProps) {
  const stacked = layout === "stacked";
  return (
    <div
      role="img"
      aria-label={`Your anti-phishing phrase: ${phrase.word}`}
      className={cn(stacked ? "flex flex-col items-center gap-1.5" : "inline-flex items-center gap-2", className)}
    >
      <SecurityPhraseIcon svgMarkup={iconSvg} size={stacked ? 44 : 22} />
      <span className={cn("text-label", stacked ? "font-medium text-muted" : "font-semibold text-foreground")}>
        {phrase.word}
      </span>
    </div>
  );
}
