import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `theme.css`'s custom `--text-*` type scale (caption/label/body/h3/h2)
 * registers `text-caption`/`text-label`/etc. as font-size utilities, but
 * `tailwind-merge`'s default classification has no way to know that —
 * it only recognizes Tailwind's built-in `text-{size}` scale (`text-sm`,
 * `text-lg`, ...) as the `font-size` group, so it fell back to guessing
 * these custom names belong to the `text-color` group instead (the only
 * other group `text-*` maps to) and silently dropped whichever `text-*`
 * class came first in a className string as a "conflict" — e.g.
 * `SendReceiveActions.tsx`'s `text-background` (color) losing to a later
 * `text-label` (size) even though the two aren't actually related.
 * Declaring this scale's names as their own `font-size` group (extending,
 * not replacing, Tailwind's own scale — same fix shadcn/ui's own docs
 * give for a custom theme scale) is what makes `twMerge` treat them as
 * independent from `text-{color}` instead of clobbering one or the other.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-caption", "text-label", "text-body", "text-h3", "text-h2"],
    },
  },
});

/**
 * Tailwind-aware class name combinator, the shadcn/ui convention: `clsx`
 * for conditional composition, `twMerge` to resolve conflicting utility
 * classes deterministically.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
