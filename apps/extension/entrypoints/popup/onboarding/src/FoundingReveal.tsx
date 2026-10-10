import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RuntimePort } from "@gleam/core";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { foundingPost, inviteLinkFor, invitesLine, xIntentUrl } from "@/src/points-share";
import { usePointsScores } from "../../points/src/usePoints";

export const REVEAL_SEEN_QUERY_KEY = ["points", "revealSeen"] as const;

export interface FoundingRevealProps {
  seatsLeft: number | null;
  inviteCode: string | null;
  onDone: () => void;
}

export function FoundingReveal({ seatsLeft, inviteCode, onDone }: FoundingRevealProps) {
  const shareHref = inviteCode
    ? xIntentUrl(foundingPost({ seats: seatsLeft, link: inviteLinkFor(inviteCode) }))
    : null;

  return (
    <div className="flex min-h-full flex-col items-center px-8 pb-6 pt-7">
      <div className="mt-12 flex flex-col items-center gap-1 text-center">
        <h1 className="text-h2 font-semibold tracking-tight text-foreground">You&apos;re in</h1>
        <p className="text-body text-muted">You&apos;re now earning GLEAM.</p>
      </div>
      <Beam className="gleam-beam-sweep mt-4 w-24" />

      <div className="mt-8 flex min-h-[48px] flex-col items-center gap-1 text-center">
        {seatsLeft !== null ? <p className="text-h3 font-semibold text-foreground">{invitesLine(seatsLeft)}</p> : null}
      </div>

      <div className="mt-auto flex w-full flex-col gap-3 pt-6">
        {shareHref ? (
          <Button asChild>
            <a href={shareHref} target="_blank" rel="noreferrer">
              Share on X
            </a>
          </Button>
        ) : (
          <Button disabled>Share on X</Button>
        )}
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export interface FoundingRevealScreenProps {
  runtime: RuntimePort;
  walletId: string;
  address: string;
  /** The wallet's own code, when the caller already has it; the server's scores supply it otherwise. */
  inviteCode?: string;
  onDone: () => void;
}

/**
 * Reads the wallet's standing and shows the reveal. A wallet the server
 * numbers as null (it registered after Phase 1) has nothing to reveal and
 * is skipped. The wallet counts as seen only on Done, so closing the
 * popup first (or a failed read) shows the reveal again on a later open.
 */
export function FoundingRevealScreen({ runtime, walletId, address, inviteCode, onDone }: FoundingRevealScreenProps) {
  const queryClient = useQueryClient();
  const scores = usePointsScores(runtime, true);
  const score = scores.data?.wallets.find((candidate) => candidate.address === address) ?? null;
  const foundingNumber = score?.foundingNumber ?? null;
  const skip = scores.isSuccess && score !== null && foundingNumber === null;

  const markSeen = useMutation({
    mutationFn: () => runtime.send<{ walletId: string }, void>({ type: "markPointsRevealSeen", payload: { walletId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REVEAL_SEEN_QUERY_KEY }),
  });
  useEffect(() => {
    if (skip) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  if (skip) return null;
  return (
    <FoundingReveal
      seatsLeft={score?.seatsLeft ?? null}
      inviteCode={score?.inviteCode ?? inviteCode ?? null}
      onDone={() => {
        if (foundingNumber !== null) markSeen.mutate();
        onDone();
      }}
    />
  );
}
