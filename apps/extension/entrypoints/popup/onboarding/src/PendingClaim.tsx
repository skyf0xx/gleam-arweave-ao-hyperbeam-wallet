import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { FOUNDING_GATE } from "@/src/founding-gate";
import { usePointsMemberships } from "../../points/src/usePoints";
import { CLAIM_PENDING_QUERY_KEY, ClaimStep, type ClaimPhase } from "./ClaimStep";

export interface PendingClaimProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  /** Defaults to the build's phase from `FOUNDING_GATE`. */
  phase?: ClaimPhase;
  children: ReactNode;
}

/**
 * Brings back a claim step the popup closed on (a link click closes it).
 * It shows until the wallet joins or the user taps Not now. After a
 * Phase 1 claim, `children` takes over, and the founding reveal there
 * picks up the new member. A failed read shows `children`: the claim is
 * an offer, never a gate.
 */
export function PendingClaim({ runtime, wallet, phase = FOUNDING_GATE ? "founding" : "open", children }: PendingClaimProps) {
  const pending = useQuery({
    queryKey: CLAIM_PENDING_QUERY_KEY,
    queryFn: () => runtime.send<undefined, string[]>({ type: "getPointsClaimPending", payload: undefined }),
    retry: false,
  });
  const memberships = usePointsMemberships(runtime, { retry: false });

  if (pending.isPending || memberships.isPending) return null;
  const waiting = pending.data?.includes(wallet.id) === true && memberships.data?.[wallet.id] === undefined;
  if (!waiting) return <>{children}</>;

  return <ClaimStep runtime={runtime} walletId={wallet.id} phase={phase} onClaimed={() => {}} onSkip={() => {}} />;
}
