import { cn } from "../../primitives/cn";

/**
 * The five-color beam + wordmark brand moment (onboarding.html's
 * `.brand-mark`, unlock-screen.html's identical structure). Per
 * brand/guidelines.md Part 2, the beam is a signature ("small beam under
 * a navigation area"), never a decorative rainbow gradient elsewhere —
 * this component is the one sanctioned place it renders at brand size.
 */
export interface BeamMarkProps {
  tagline: string;
  className?: string;
}

export function BeamMark({ tagline, className }: BeamMarkProps) {
  return (
    <div className={cn("flex flex-col items-center gap-[18px]", className)}>
      <div
        role="presentation"
        className="h-[3px] w-10 rounded-sm"
        style={{
          background:
            "linear-gradient(to right, #FF1717 0% 20%, #8B12FF 20% 40%, #73C9E8 40% 60%, #FFE45C 60% 80%, #28F02D 80% 100%)",
        }}
      />
      <div className="text-[22px] font-bold tracking-[-0.015em] text-[#111111]">
        gleam
      </div>
      <div className="-mt-[10px] text-[13px] text-[#737373]">{tagline}</div>
    </div>
  );
}
