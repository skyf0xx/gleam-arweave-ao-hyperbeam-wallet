import { cn } from "../../primitives/cn";

/**
 * Plain neutral strength bars (onboarding.html's `.strength-meter`) — per
 * brand/guidelines.md's "no strength-meter gamification (no emoji, no
 * 'weak/strong' colored bars beyond a plain neutral indicator)", `filled`
 * is a count out of 4 bars, all one color.
 */
export interface PasswordStrengthMeterProps {
  filled: number;
  className?: string;
}

const BAR_COUNT = 4;

export function PasswordStrengthMeter({ filled, className }: PasswordStrengthMeterProps) {
  const clamped = Math.max(0, Math.min(BAR_COUNT, filled));
  return (
    <div className={cn("flex gap-1", className)} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-[3px] flex-1 rounded-sm bg-[#e5e5e5]",
            index < clamped && "bg-[#111111]",
          )}
        />
      ))}
    </div>
  );
}
