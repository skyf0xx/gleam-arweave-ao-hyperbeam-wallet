import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InviteUnlock, RuntimePort } from "@gleam/core";
import { FOUNDING_GATE } from "@/src/founding-gate";
import { FoundingGate } from "./FoundingGate";
import { OnboardingView } from "./OnboardingView";

export interface GatedOnboardingProps {
  runtime: RuntimePort;
  onComplete: () => void;
  /** Defaults to the build-time `FOUNDING_GATE` flag. */
  gateEnabled?: boolean;
}

/**
 * First-run onboarding behind the Founding gate. Only installs with no
 * vault get here, so a gate that fails to load its state opens onboarding
 * rather than blocking: it focuses the launch and isn't a security
 * boundary.
 */
export function GatedOnboarding({ runtime, onComplete, gateEnabled = FOUNDING_GATE }: GatedOnboardingProps) {
  const [passed, setPassed] = useState(false);
  const claim = gateEnabled ? "founding" : "open";
  const stored = useQuery({
    queryKey: ["points", "inviteUnlock"],
    queryFn: () => runtime.send<undefined, InviteUnlock | null>({ type: "getPointsInviteUnlock", payload: undefined }),
    enabled: gateEnabled,
    // Read once: a focus refetch must not swap the gate out mid-flow.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    gcTime: 0,
    retry: false,
  });

  if (!gateEnabled || passed || stored.isError) return <OnboardingView runtime={runtime} onComplete={onComplete} claim={claim} />;
  if (stored.isPending) return null;
  if (stored.data?.result === "ok") return <OnboardingView runtime={runtime} onComplete={onComplete} claim={claim} />;
  return <FoundingGate runtime={runtime} initialUnlock={stored.data} onUnlocked={() => setPassed(true)} />;
}
