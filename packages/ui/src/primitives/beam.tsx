import { cn } from "./cn";

/**
 * The Gleam beam — the brand's signature five-color identity element
 * (brand/identity.md §02/§03, shared.css `.beam-divider`).
 *
 * Identity-only, per brand/guidelines.md Part 3: "Never use the
 * five-color beam as a severity/warning signal — it's reserved for
 * brand/identity moments." This component exists specifically so no
 * screen ever reaches for a bespoke five-stop gradient of its own to
 * repurpose as a status indicator — the only place this shape is
 * defined is here, and it never accepts a `variant`/`tone` prop, by
 * design, to keep it impossible to theme it into a warning color.
 */
export interface BeamProps {
  className?: string;
}

export function Beam({ className }: BeamProps) {
  return <div role="presentation" className={cn("gleam-beam-divider w-full", className)} />;
}

/**
 * The beam rendered as five discrete segments (brand/identity.md's
 * "■ ■ ■ ■ ■" mark), for contexts needing the beam as a small mark
 * rather than a continuous divider bar (e.g. next to the wordmark).
 */
export function BeamMark({ className }: BeamProps) {
  const segments = [
    "var(--color-beam-red)",
    "var(--color-beam-purple)",
    "var(--color-beam-sky)",
    "var(--color-beam-yellow)",
    "var(--color-beam-green)",
  ];
  return (
    <div role="presentation" className={cn("flex items-center gap-0.5", className)}>
      {segments.map((color, index) => (
        <span key={index} className="h-2.5 w-2.5 rounded-[1px]" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}
