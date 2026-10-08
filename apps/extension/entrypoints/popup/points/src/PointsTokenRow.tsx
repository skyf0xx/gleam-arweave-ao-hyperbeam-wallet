import type { RuntimePort, WalletSummary } from "@gleam/core";
import { TokenRow } from "@gleam/ui/src/components/wallet/TokenRow.tsx";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { formatPoints } from "./formatPoints";
import { usePointsStanding } from "./usePoints";

export interface PointsTokenRowProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onOpen: () => void;
}

/**
 * Gleam Points as the token list's third row, after AR and AO. It reads
 * like a balance but isn't a token: no USD value and no send action, and
 * its icon is the Gleam beam rather than a ticker glyph, marking it as
 * Gleam's own. Clicking opens the Points screen.
 */
export function PointsTokenRow({ runtime, wallet, onOpen }: PointsTokenRowProps) {
  const standing = usePointsStanding(runtime, wallet);
  const amount =
    standing.status === "joined"
      ? `${formatPoints(standing.estimateAtomic)} points`
      : standing.status === "not-joined"
        ? "Sign up"
        : "—";

  return (
    <TokenRow
      glyph={{ label: "GP" }}
      icon={<PointsIcon />}
      name="Gleam Points"
      amount={amount}
      onClick={onOpen}
    />
  );
}

/** Same footprint as `TokenGlyph`, holding a short beam instead of a ticker. */
function PointsIcon() {
  return (
    <div
      aria-hidden="true"
      className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg border border-line bg-background"
    >
      <Beam className="w-4" />
    </div>
  );
}
