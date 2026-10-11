import { useEffect, useRef, useState } from "react";
import type { PointsSharePrompt, PointsWalletScore, RuntimePort, WalletSummary } from "@gleam/core";
import { FOUNDING_GATE } from "@/src/founding-gate";
import { foundingPost, gainedSeatPost, inviteLinkFor, lastSeatPost } from "@/src/points-share";
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
  /** The named prompts this wallet has already acted on. */
  shareSeen: readonly PointsSharePrompt[];
  /** The seat count the member was last shown; undefined if never recorded. */
  seatsSeen: number | undefined;
  /** Whether the founding reveal already gave this wallet its first share. */
  revealSeen: boolean;
}

/**
 * Picks the one prompt to show. A new invite comes first because it is
 * news and time-bound, then the last seat, then the join moment, which the
 * always-available Invite on X also covers. The join prompt is skipped when
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

export interface PromptContent {
  /** Stands in for the Invite section's heading. */
  text: string;
  post: string;
}

function promptContent(kind: SharePromptKind, score: PointsWalletScore, link: string): PromptContent {
  switch (kind) {
    case "gainedSeat":
      return { text: "A friend joined. You got another invite.", post: gainedSeatPost({ link }) };
    case "lastSeat":
      return { text: "Your last invite", post: lastSeatPost() };
    case "joined":
      return { text: "You're in and earning Gleam Points.", post: foundingPost({ seats: score.seatsLeft, link }) };
  }
}

export interface SharePromptArgs {
  runtime: RuntimePort;
  wallet: WalletSummary;
  inviteCode: string;
  score: PointsWalletScore | null;
}

export interface ActiveSharePrompt extends PromptContent {
  /** Records the prompt as acted on; call when the member shares or copies. */
  finish: () => void;
}

/**
 * The Invite section's one-time news (POINTS.md § Share prompts): at most
 * one prompt, which takes over the section's heading and the post behind
 * its Invite on X. Opening the screen records the seat count as seen, which
 * clears the toolbar dot; the prompt stays for this visit, and a named
 * prompt returns until the member shares or copies from it.
 */
export function useSharePrompt({ runtime, wallet, inviteCode, score }: SharePromptArgs): ActiveSharePrompt | null {
  const seats = score?.seatsLeft ?? null;
  const ready = FOUNDING_GATE && seats !== null;
  const shareSeen = usePointsShareSeen(runtime, ready);
  const seatsSeen = usePointsSeatsSeen(runtime, ready);
  const revealSeen = usePointsRevealSeen(runtime, ready);
  const markSeats = useMarkSeatsSeen(runtime);
  const markShare = useMarkShareSeen(runtime);
  const [shown, setShown] = useState<SharePromptKind | null>(null);

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
  if (kind === null || score === null) return null;
  return {
    ...promptContent(kind, score, inviteLinkFor(inviteCode)),
    // A new invite was marked seen when it showed; the named prompts only once acted on.
    finish: () => {
      if (kind !== "gainedSeat") markShare.mutate({ walletId: wallet.id, prompt: kind });
    },
  };
}
