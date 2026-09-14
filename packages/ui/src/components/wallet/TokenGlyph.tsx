import { cn } from "../../primitives/cn";

/**
 * The small colored square token identicon (wallet-main-screen.html's
 * `.token-glyph.tone-{1..4}`) — one/two-letter ticker abbreviation on a
 * flat neutral tone. Brand guidelines Part 2: neutrals only here, the
 * five-color beam is never used to color a token glyph.
 */
export interface TokenGlyphProps {
  label: string;
  tone?: 1 | 2 | 3 | 4;
  className?: string;
}

/**
 * Tones 2-4 are a neutral gradient distinct from the foundation `muted`/
 * `faint` tokens (which are reserved for text) — kept as literals since
 * `tokens/theme.css` defines no separate glyph-tone scale, per the same
 * "no mismatched token" judgment call the `BeamMark` wordmark size debt
 * note (`DESIGN-SYSTEM-PASS-ONBOARDING-UNLOCK`) already made.
 */
const TONE_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-foreground text-background",
  2: "bg-[#52525b] text-white",
  3: "bg-[#8a8a8f] text-white",
  4: "bg-[#d4d4d8] text-foreground",
};

export function TokenGlyph({ label, tone = 1, className }: TokenGlyphProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-[-0.02em]",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {label}
    </div>
  );
}
