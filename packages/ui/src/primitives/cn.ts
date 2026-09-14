import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware class name combinator, the shadcn/ui convention: `clsx`
 * for conditional composition, `twMerge` to resolve conflicting utility
 * classes deterministically.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
