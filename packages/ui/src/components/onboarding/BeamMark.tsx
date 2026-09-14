import { cn } from "../../primitives/cn";
import { Beam } from "../../primitives/beam";

/**
 * The five-color beam + wordmark brand moment (onboarding.html's
 * `.brand-mark`, unlock-screen.html's identical structure). Per
 * brand/guidelines.md Part 2, the beam is a signature ("small beam under
 * a navigation area"), never a decorative rainbow gradient elsewhere —
 * this component is the one sanctioned place it renders at brand size,
 * composing the shared `Beam` primitive rather than redefining its own
 * copy of the five-stop gradient.
 */
export interface BeamMarkProps {
  tagline: string;
  className?: string;
}

export function BeamMark({ tagline, className }: BeamMarkProps) {
  return (
    <div className={cn("flex flex-col items-center gap-[18px]", className)}>
      <Beam className="w-10" />
      <div className="text-[22px] font-bold tracking-[-0.015em] text-foreground">gleam</div>
      <div className="-mt-[10px] text-body text-muted">{tagline}</div>
    </div>
  );
}
