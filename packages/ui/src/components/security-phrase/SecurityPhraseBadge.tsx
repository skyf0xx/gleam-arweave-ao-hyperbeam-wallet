import type { SecurityPhrase } from "@gleam/core";
import { cn } from "../../primitives/cn";

export interface SecurityPhraseBadgeProps {
  phrase: SecurityPhrase;
  className?: string;
}

/**
 * The user's anti-phishing phrase. Gleam's own screens show it; a window
 * drawn by a web page can't, so its absence is the warning sign.
 */
export function SecurityPhraseBadge({ phrase, className }: SecurityPhraseBadgeProps) {
  return (
    <div
      className={cn("inline-flex items-center gap-2 rounded-full border border-line px-3 py-1", className)}
      aria-label={`Your security phrase: ${phrase.word}`}
    >
      <span aria-hidden="true" className="text-[15px] leading-none">
        {phrase.emoji}
      </span>
      <span className="text-label font-semibold text-foreground">{phrase.word}</span>
    </div>
  );
}
