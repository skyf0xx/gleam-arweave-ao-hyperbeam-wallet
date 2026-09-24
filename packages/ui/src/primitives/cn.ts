import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `theme.css`'s custom `--text-*` type scale (caption/label/body/h3/h2)
 * registers `text-caption`/`text-label`/etc. as font-size utilities, but
 * `tailwind-merge`'s default classification has no way to know that — it
 * only recognizes Tailwind's built-in `text-{size}` scale as the
 * `font-size` group, so it fell back to treating these custom names as
 * `text-color` and silently dropped whichever `text-*` class came first
 * as a "conflict" (e.g. `text-background` losing to a later `text-label`
 * even though the two aren't related). Declaring this scale's names as
 * their own `font-size` group is what makes `twMerge` treat them as
 * independent from `text-{color}`.
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
