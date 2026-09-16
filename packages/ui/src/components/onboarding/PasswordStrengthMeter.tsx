import { cn } from "../../primitives/cn";

export interface PasswordStrengthMeterProps {
  filled: number;
  className?: string;
}

const BAR_COUNT = 4;

const STRENGTH_COLORS = [
  "var(--color-beam-red)",
  "var(--color-beam-purple)",
  "var(--color-beam-sky)",
  "var(--color-beam-green)",
];

const STRENGTH_LABELS = ["Weak", "Fair", "Good", "Strong"];

export function PasswordStrengthMeter({ filled, className }: PasswordStrengthMeterProps) {
  const clamped = Math.max(0, Math.min(BAR_COUNT, filled));
  const strengthLabel = clamped > 0 ? STRENGTH_LABELS[clamped - 1] : "";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const isFilledBar = index < clamped;
          const fillLevel = clamped - 1;
          const color = isFilledBar ? STRENGTH_COLORS[fillLevel] : "var(--color-line)";

          return (
            <span
              key={index}
              className="h-[3px] flex-1 rounded-sm"
              style={{ backgroundColor: color }}
            />
          );
        })}
      </div>
      {strengthLabel && (
        <span className="text-xs text-muted">{strengthLabel}</span>
      )}
    </div>
  );
}
