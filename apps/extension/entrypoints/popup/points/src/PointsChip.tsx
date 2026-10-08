import type { RuntimePort, WalletSummary } from "@gleam/core";
import { formatPoints } from "./formatPoints";
import { usePointsStanding } from "./usePoints";

export interface PointsChipProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onOpen: () => void;
}

/** The header's entry point to Gleam Points: the live total, or an invitation to join. */
export function PointsChip({ runtime, wallet, onOpen }: PointsChipProps) {
  const standing = usePointsStanding(runtime, wallet);
  if (standing.status === "loading") return null;

  const label = standing.status === "joined" ? `${formatPoints(standing.estimateAtomic)} pts` : "Earn points";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={standing.status === "joined" ? `Gleam Points: ${label}` : "Join Gleam Points"}
      className="flex h-8 flex-shrink-0 items-center rounded-full border border-line px-2.5 text-label tabular-nums text-foreground hover:bg-mist"
    >
      {label}
    </button>
  );
}
