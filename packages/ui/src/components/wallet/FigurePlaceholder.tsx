import type { ReactNode } from "react";

/** Holds a figure's space with a shimmer until it is first read, so nothing is ever shown as a stand-in 0. */
export function FigurePlaceholder({ children }: { children: ReactNode }) {
  return (
    <span data-testid="figure-placeholder" className="relative inline-block">
      <span className="invisible">{children}</span>
      <span aria-hidden="true" className="gleam-shimmer absolute inset-x-0 inset-y-[0.15em] rounded-md" />
    </span>
  );
}
