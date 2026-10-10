import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PointsMembership, RuntimePort } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { BeamMark } from "@gleam/ui/src/components/onboarding/index.ts";
import { JoinNote } from "../../points/src/JoinNote";
import { useJoinPoints, usePendingInvite } from "../../points/src/usePoints";

export const CLAIM_PENDING_QUERY_KEY = ["points", "claimPending"] as const;

/** `founding` is the Phase 1 build, where a claim is followed by the reveal. */
export type ClaimPhase = "founding" | "open";

export interface ClaimStepProps {
  runtime: RuntimePort;
  walletId: string;
  onClaimed: (membership: PointsMembership) => void;
  onSkip: () => void;
}

/**
 * The last onboarding step (POINTS.md § Extension): opt in to Gleam Points,
 * or skip. It stays pending until one of the two, so it comes back on the
 * home screen if the popup closes first.
 */
export function ClaimStep({ runtime, walletId, onClaimed, onSkip }: ClaimStepProps) {
  const join = useJoinPoints(runtime);
  const pending = usePendingInvite(runtime);
  const queryClient = useQueryClient();
  const skip = useMutation({
    mutationFn: () =>
      runtime.send<{ walletId: string; pending: boolean }, void>({
        type: "setPointsClaimPending",
        payload: { walletId, pending: false },
      }),
    // Skipping never blocks: if the flag can't be cleared, the step returns next open.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: CLAIM_PENDING_QUERY_KEY });
      onSkip();
    },
  });

  return (
    <div className="flex min-h-full flex-col items-center px-8 pb-6 pt-7">
      <div className="mt-6">
        <BeamMark />
      </div>

      <div className="mt-7 flex flex-col items-center gap-2 text-center">
        <h1 className="text-h2 font-semibold tracking-tight text-foreground">
          Start earning Gleam Points
        </h1>
        <p className="text-body text-muted">
          Earn points every day for the AR and AO you hold. Invite friends and you both earn more.
        </p>
        {pending.data ? (
          <p className="text-caption text-muted">
            Invite code <span className="font-mono tracking-[0.08em] text-foreground">{pending.data}</span> will be applied.
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex w-full flex-col gap-3 pt-6">
        {join.error instanceof Error ? <p className="text-center text-caption text-warning">{join.error.message}</p> : null}
        <Button
          disabled={join.isPending}
          onClick={() => join.mutate({ walletId }, { onSuccess: onClaimed })}
        >
          {join.isPending ? "Joining…" : "Join Gleam Points"}
        </Button>
        <Button variant="secondary" disabled={join.isPending || skip.isPending} onClick={() => skip.mutate()}>
          Not now
        </Button>
        <JoinNote />
      </div>
    </div>
  );
}
