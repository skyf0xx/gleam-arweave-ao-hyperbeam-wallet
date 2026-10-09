import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RuntimePort, WalletSummary } from "@gleam/core";
import { FOUNDING_GATE } from "@/src/founding-gate";
import { usePointsMemberships, usePointsScores } from "../../points/src/usePoints";
import { FoundingRevealScreen, REVEAL_SEEN_QUERY_KEY } from "./FoundingReveal";

export interface ExistingMemberRevealProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  /** Defaults to the build-time `FOUNDING_GATE` flag: only Phase 1 has founding numbers. */
  enabled?: boolean;
  children: ReactNode;
}

/**
 * Shows the founding reveal once, on the first popup open after the
 * update, to a wallet that joined Gleam Points before founding numbers
 * existed (POINTS.md journey E). Anything that stops it from being
 * decided (a failed read, no number yet) shows `children` instead:
 * the reveal is a courtesy, never a gate.
 */
export function ExistingMemberReveal({ runtime, wallet, enabled = FOUNDING_GATE, children }: ExistingMemberRevealProps) {
  const [dismissed, setDismissed] = useState(false);
  const memberships = usePointsMemberships(runtime, { enabled, retry: false });
  const membership = memberships.data?.[wallet.id] ?? null;
  const seen = useQuery({
    queryKey: REVEAL_SEEN_QUERY_KEY,
    queryFn: () => runtime.send<undefined, string[]>({ type: "getPointsRevealSeen", payload: undefined }),
    enabled,
    retry: false,
  });
  const unseenMember = membership !== null && seen.isSuccess && !seen.data.includes(wallet.id);
  const scores = usePointsScores(runtime, enabled && unseenMember);
  // The reveal marks the wallet seen as soon as it shows, which would
  // otherwise swap it out for `children` mid-view.
  const revealing = useRef(false);

  if (!enabled || dismissed) return <>{children}</>;
  if (!revealing.current) {
    if (memberships.isPending || seen.isPending) return null;
    if (!unseenMember) return <>{children}</>;
    if (scores.isPending) return null;
    const score = scores.data?.wallets.find((candidate) => candidate.address === wallet.address);
    if (score?.foundingNumber == null) return <>{children}</>;
    revealing.current = true;
  }

  return (
    <FoundingRevealScreen
      runtime={runtime}
      walletId={wallet.id}
      address={wallet.address}
      inviteCode={membership?.inviteCode}
      onDone={() => setDismissed(true)}
    />
  );
}
