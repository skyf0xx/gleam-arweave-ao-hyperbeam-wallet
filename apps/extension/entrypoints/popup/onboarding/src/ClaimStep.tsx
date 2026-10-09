import { useQuery } from "@tanstack/react-query";
import type { PointsMembership, RuntimePort } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { BeamMark } from "@gleam/ui/src/components/onboarding/index.ts";
import { JoinNote } from "../../points/src/JoinNote";
import { useJoinPoints } from "../../points/src/usePoints";

/** `founding` is the Phase 1 build, where joining earns a founding number. */
export type ClaimPhase = "founding" | "open";

export interface ClaimStepProps {
  runtime: RuntimePort;
  walletId: string;
  phase: ClaimPhase;
  onClaimed: (membership: PointsMembership) => void;
  onSkip: () => void;
}

/** The last onboarding step (POINTS.md § Extension): opt in to Gleam Points, or skip. */
export function ClaimStep({ runtime, walletId, phase, onClaimed, onSkip }: ClaimStepProps) {
  const join = useJoinPoints(runtime);
  const pending = useQuery({
    queryKey: ["points", "pendingInvite"],
    queryFn: () => runtime.send<undefined, string | null>({ type: "getPointsPendingInvite", payload: undefined }),
    staleTime: Infinity,
    retry: false,
  });
  const founding = phase === "founding";

  return (
    <div className="flex min-h-full flex-col items-center px-8 pb-6 pt-7">
      <div className="mt-6">
        <BeamMark />
      </div>

      <div className="mt-7 flex flex-col items-center gap-2 text-center">
        <h1 className="text-h2 font-semibold tracking-tight text-foreground">
          {founding ? "Claim your founding number" : "Start earning Gleam Points"}
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
          {join.isPending ? "Joining…" : founding ? "Claim" : "Join Gleam Points"}
        </Button>
        <Button variant="secondary" disabled={join.isPending} onClick={onSkip}>
          Not now
        </Button>
        <JoinNote />
      </div>
    </div>
  );
}
