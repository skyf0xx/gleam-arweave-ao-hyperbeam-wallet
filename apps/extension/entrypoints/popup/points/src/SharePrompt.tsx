import { useEffect, useRef, useState } from "react";
import type { PointsSharePrompt, PointsWalletScore, RuntimePort, WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { FOUNDING_GATE } from "@/src/founding-gate";
import { foundingPost, gainedSeatPost, inviteLinkFor, lastSeatPost, xIntentUrl } from "@/src/points-share";
import { useCopy } from "./useCopy";
import {
  useMarkSeatsSeen,
  useMarkShareSeen,
  usePointsRevealSeen,
  usePointsSeatsSeen,
  usePointsShareSeen,
} from "./usePoints";

export type SharePromptKind = "gainedSeat" | PointsSharePrompt;

export interface SharePromptState {
  score: PointsWalletScore;
  /** The named prompts this wallet has already dismissed or acted on. */
  shareSeen: readonly PointsSharePrompt[];
  /** The seat count the member was last shown; undefined if never recorded. */
  seatsSeen: number | undefined;
  /** Whether the founding reveal already gave this wallet its first share. */
  revealSeen: boolean;
}

/**
 * Picks the one prompt to show. A new invite comes first because it is
 * news and time-bound, then the last seat, then the join moment, which the
 * always-available share card also covers. The join prompt is skipped when
 * the founding reveal already offered the same post.
 */
export function pickSharePrompt({ score, shareSeen, seatsSeen, revealSeen }: SharePromptState): SharePromptKind | null {
  const seats = score.seatsLeft;
  if (!FOUNDING_GATE || seats === null) return null;
  if (seatsSeen !== undefined && seats > seatsSeen) return "gainedSeat";
  if (seats === 1 && !shareSeen.includes("lastSeat")) return "lastSeat";
  if (score.foundingNumber !== null && !revealSeen && !shareSeen.includes("joined")) return "joined";
  return null;
}

interface PromptContent {
  text: string;
  post: string;
  /** Null when the post carries no link on purpose. */
  link: string | null;
}

function promptContent(kind: SharePromptKind, score: PointsWalletScore, link: string): PromptContent {
  switch (kind) {
    case "gainedSeat":
      return {
        text: "Someone you invited joined. You have another invite.",
        post: gainedSeatPost({ link }),
        link,
      };
    case "lastSeat":
      return { text: "You have one invite left.", post: lastSeatPost(), link: null };
    case "joined":
      return {
        text: `You joined as OG #${score.foundingNumber}.`,
        post: foundingPost({ seats: score.seatsLeft, link }),
        link,
      };
  }
}

export interface SharePromptProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  inviteCode: string;
  score: PointsWalletScore | null;
}

/**
 * The Invite section's banner (POINTS.md § Share prompts): at most one
 * prompt, each shown once. Opening the screen records the seat count as
 * seen, which clears the toolbar dot; the banner stays up for this visit
 * and does not return on the next.
 */
export function SharePrompt({ runtime, wallet, inviteCode, score }: SharePromptProps) {
  const seats = score?.seatsLeft ?? null;
  const ready = FOUNDING_GATE && seats !== null;
  const shareSeen = usePointsShareSeen(runtime, ready);
  const seatsSeen = usePointsSeatsSeen(runtime, ready);
  const revealSeen = usePointsRevealSeen(runtime, ready);
  const markSeats = useMarkSeatsSeen(runtime);
  const markShare = useMarkShareSeen(runtime);
  const [shown, setShown] = useState<SharePromptKind | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const loaded = score !== null && ready && shareSeen.isSuccess && seatsSeen.isSuccess && revealSeen.isSuccess;
  const pick = loaded
    ? pickSharePrompt({
        score,
        shareSeen: shareSeen.data[wallet.id] ?? [],
        seatsSeen: seatsSeen.data[wallet.id],
        revealSeen: revealSeen.data.includes(wallet.id),
      })
    : null;

  // The pick is latched: recording the seat count below changes it.
  useEffect(() => {
    if (shown === null && pick !== null) setShown(pick);
  }, [pick, shown]);

  const recorded = useRef(false);
  useEffect(() => {
    if (!loaded || recorded.current || seats === null) return;
    recorded.current = true;
    if (seatsSeen.data[wallet.id] !== seats) markSeats.mutate({ walletId: wallet.id, seats });
    // `markSeats.mutate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, seats, seatsSeen.data, wallet.id]);

  const kind = shown ?? pick;
  const link = inviteLinkFor(inviteCode);
  const { copied, copy } = useCopy(link);
  if (kind === null || score === null || dismissed) return null;

  const content = promptContent(kind, score, link);
  // A new invite is marked seen when it shows; the named prompts only once acted on.
  const finish = () => {
    if (kind !== "gainedSeat") markShare.mutate({ walletId: wallet.id, prompt: kind });
  };

  return (
    <section aria-label="Share prompt" className="relative flex flex-col gap-3 rounded-lg border border-line px-3 py-3">
      <p className="pr-6 text-label text-foreground">{content.text}</p>
      <div className="flex gap-2">
        <Button asChild size="sm">
          <a href={xIntentUrl(content.post)} target="_blank" rel="noreferrer" onClick={() => finish()}>
            Share on X
          </a>
        </Button>
        {content.link ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              copy();
              finish();
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center text-body text-faint hover:text-foreground"
        onClick={() => {
          finish();
          setDismissed(true);
        }}
      >
        ×
      </button>
    </section>
  );
}
