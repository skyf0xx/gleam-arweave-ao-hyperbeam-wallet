import type { RuntimePort, WalletSummary } from "@gleam/core";
import { TokenRow } from "@gleam/ui/src/components/wallet/TokenRow.tsx";
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
 * the glyph tone differs from the token rows. Clicking opens the Points
 * screen.
 */
export function PointsTokenRow({ runtime, wallet, onOpen }: PointsTokenRowProps) {
  const standing = usePointsStanding(runtime, wallet);
  const amount =
    standing.status === "joined"
      ? `${formatPoints(standing.estimateAtomic)} points`
      : standing.status === "not-joined"
        ? "Sign up"
        : "—";

  return <TokenRow glyph={{ label: "GP", tone: 1 }} name="Gleam Points" amount={amount} onClick={onOpen} />;
}
