import { cn } from "../../primitives/cn";
import { Beam } from "../../primitives/beam";

/**
 * The five-color beam + wordmark brand moment. The beam is a signature,
 * never a decorative rainbow gradient elsewhere — this component is the
 * one sanctioned place it renders at brand size, composing the shared
 * `Beam` primitive rather than redefining its own copy of the five-stop
 * gradient.
 */
export interface BeamMarkProps {
  tagline?: string;
  /** Draws the beam in once on mount. */
  animated?: boolean;
  className?: string;
}

export function BeamMark({ tagline, animated = false, className }: BeamMarkProps) {
  return (
    <div className={cn("flex flex-col items-center gap-[18px]", className)}>
      <Beam className={cn("w-10", animated && "gleam-beam-sweep")} />
      <div className="text-[22px] font-bold tracking-[-0.015em] text-foreground">gleam</div>
      {tagline ? <div className="-mt-[10px] text-body text-muted">{tagline}</div> : null}
    </div>
  );
}
