import { useEffect, useState } from "react";
import { cn } from "../../primitives/cn";
import { useCachedLogo } from "./logo-cache";

/**
 * The small colored square token identicon — one/two-letter ticker
 * abbreviation on a flat neutral tone. Neutrals only: the five-color
 * beam is never used to color a token glyph. With a `logoUrl` the logo
 * fills the square instead, kept on the device by `logo-cache.ts`, and
 * the letters stand in when it is absent or fails to load.
 */
export interface TokenGlyphProps {
  label: string;
  tone?: 1 | 2 | 3 | 4;
  logoUrl?: string | null;
  className?: string;
}

/**
 * Tones 2-4 are a neutral gradient distinct from the foundation `muted`/
 * `faint` tokens (which are reserved for text) — kept as literals since
 * `tokens/theme.css` defines no separate glyph-tone scale.
 */
const TONE_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-foreground text-background",
  2: "bg-[#52525b] text-white",
  3: "bg-[#8a8a8f] text-white",
  4: "bg-[#d4d4d8] text-foreground",
};

export function TokenGlyph({ label, tone = 1, logoUrl, className }: TokenGlyphProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => setFailedUrl(null), [logoUrl]);
  const src = useCachedLogo(logoUrl);
  // Dark sets the logo on a plate and fades it a little, so a white logo doesn't glare on the dark sheet.
  const imageClass = cn("h-[30px] w-[30px] flex-shrink-0 rounded-lg bg-mist object-cover layered:p-[3px] dark:opacity-90", className);

  if (logoUrl && logoUrl !== failedUrl) {
    // Reading the on-device cache takes a moment; a blank tile avoids flashing the letters first.
    if (src === undefined) return <div aria-hidden="true" className={imageClass} />;
    return (
      <img
        src={src ?? logoUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(logoUrl)}
        className={imageClass}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg text-micro font-bold tracking-[-0.02em]",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {label}
    </div>
  );
}
