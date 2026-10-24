import { capabilitiesFor, type RuntimePort, type WalletSummary } from "@gleam/core";
import { TokenRow } from "@gleam/ui/src/components/wallet/TokenRow.tsx";
import { GLEAM_POINTS_ICON_URL } from "@gleam/ui/src/tokens/default-token-icons.ts";
import { formatPoints, formatPointsCompact } from "./formatPoints";
import { usePointsStanding } from "./usePoints";

export interface PointsTokenRowProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onOpen: () => void;
  className?: string;
}

/**
 * Gleam Points as a row in the token list. It reads
 * like a balance but isn't a token: no USD value and no send action, and
 * its icon is the Gleam mark rather than a ticker glyph, marking it as
 * Gleam's own. Clicking opens the Points screen.
 */
export function PointsTokenRow({ runtime, wallet, onOpen, className }: PointsTokenRowProps) {
  const standing = usePointsStanding(runtime, wallet);
  const amount =
    standing.status === "joined"
      ? `${formatPointsCompact(standing.estimateAtomic)} points`
      : standing.status === "not-joined"
        ? capabilitiesFor(wallet.method).points
          ? "Sign up"
          : "Unavailable"
        : "—";
  const amountFull = standing.status === "joined" ? `${formatPoints(standing.estimateAtomic)} points` : undefined;

  return (
    <TokenRow
      glyph={{ label: "GP" }}
      icon={<PointsIcon />}
      name="Gleam Points"
      amount={amount}
      amountFull={amountFull !== amount ? amountFull : undefined}
      onClick={onOpen}
      className={className}
    />
  );
}

/** Same footprint as `TokenGlyph`, holding the Gleam mark instead of a ticker. */
function PointsIcon() {
  return <img src={GLEAM_POINTS_ICON_URL} alt="" aria-hidden="true" className="h-[30px] w-[30px] flex-shrink-0 object-contain" />;
}
