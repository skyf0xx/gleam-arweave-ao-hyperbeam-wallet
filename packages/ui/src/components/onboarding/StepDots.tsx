import { cn } from "../../primitives/cn";

/** Step progress indicator — plain dots, no numbers or percentage. */
export interface StepDotsProps {
  total: number;
  current: number;
  className?: string;
}

export function StepDots({ total, current, className }: StepDotsProps) {
  return (
    <div
      className={cn("flex items-center gap-[5px]", className)}
      aria-label={`Step ${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-[5px] w-[5px] rounded-full bg-line",
            index === current - 1 && "bg-foreground",
          )}
        />
      ))}
    </div>
  );
}
