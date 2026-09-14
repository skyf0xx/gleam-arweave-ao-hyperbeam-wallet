import { cn } from "../../primitives/cn";

/**
 * The large headline balance amount (wallet-main-screen.html's
 * `.balance-amount .value`, tokens-activity.html's token-detail
 * equivalent). `amountLabel` is a pre-formatted display string (e.g.
 * "128.4204 AR" or "$1,842.63") — this component does no unit
 * conversion or number formatting itself, matching RELEVANT RULES'
 * "AR balance ... rendered without float conversion": whatever string
 * the caller derived from a Winston atomic-integer amount is shown
 * verbatim.
 */
export interface BalanceDisplayProps {
  amountLabel: string;
  subLabel?: string;
  loading?: boolean;
  className?: string;
}

export function BalanceDisplay({ amountLabel, subLabel, loading = false, className }: BalanceDisplayProps) {
  if (loading) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div className="my-0.5 h-[34px] w-40 gleam-shimmer rounded-md" />
        <div className="mt-1.5 h-[13px] w-[90px] gleam-shimmer rounded-md" />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <div className="flex items-baseline gap-2.5">
        <span className="text-[36px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
          {amountLabel}
        </span>
      </div>
      {subLabel ? <div className="text-caption text-faint">{subLabel}</div> : null}
    </div>
  );
}
