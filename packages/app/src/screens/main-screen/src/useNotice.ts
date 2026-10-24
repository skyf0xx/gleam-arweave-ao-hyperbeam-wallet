import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Announcement, ReviewMoment, RuntimePort, WalletSummary } from "@gleam/core";
import { FOUNDING_GATE } from "../../../founding-gate";
import {
  useMarkSeatsSeen,
  usePointsMemberships,
  usePointsScores,
  usePointsSeatsSeen,
} from "../../points/src/usePoints";
import { pickNotice, type Notice } from "./notice";

const ANNOUNCEMENTS_STALE_MS = 60 * 60_000;
/** When this popup opened: a review moment from this visit waits for the next one. */
const OPENED_AT = Date.now();
const reviewKey = ["reviewPrompt"] as const;

const announcementKeys = {
  list: () => ["announcements", "list"] as const,
  dismissed: () => ["announcements", "dismissed"] as const,
};

export interface UseNotice {
  notice: Notice | null;
  /**
   * Dismissing the invite notice records the seats as seen, same as
   * opening Points. Any answer to the review prompt, a dismissal
   * included, retires it for good.
   */
  dismiss: () => void;
}

/** The main-screen notice for `wallet`, or null when there is nothing to show. */
export function useNotice(runtime: RuntimePort, wallet: WalletSummary): UseNotice {
  const queryClient = useQueryClient();
  const memberships = usePointsMemberships(runtime, { retry: false });
  const isMember = memberships.data?.[wallet.id] !== undefined;
  const scores = usePointsScores(runtime, isMember && FOUNDING_GATE);
  const seatsSeen = usePointsSeatsSeen(runtime, isMember && FOUNDING_GATE);
  const markSeats = useMarkSeatsSeen(runtime);

  const announcements = useQuery({
    queryKey: announcementKeys.list(),
    queryFn: () => runtime.send<undefined, Announcement[]>({ type: "getAnnouncements", payload: undefined }),
    staleTime: ANNOUNCEMENTS_STALE_MS,
    retry: false,
  });
  const dismissed = useQuery({
    queryKey: announcementKeys.dismissed(),
    queryFn: () => runtime.send<undefined, string[]>({ type: "getDismissedAnnouncements", payload: undefined }),
    retry: false,
  });
  const dismissAnnouncement = useMutation({
    mutationFn: (id: string) => runtime.send<{ id: string }, void>({ type: "dismissAnnouncement", payload: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: announcementKeys.dismissed() }),
  });

  // Read once per visit, so the prompt can't appear mid-visit as a send settles.
  const review = useQuery({
    queryKey: reviewKey,
    queryFn: () => runtime.send<{ since: number }, ReviewMoment | null>({ type: "getReviewPrompt", payload: { since: OPENED_AT } }),
    staleTime: Infinity,
    retry: false,
  });
  const finishReview = useMutation({
    mutationFn: () => runtime.send<undefined, void>({ type: "finishReviewPrompt", payload: undefined }),
    onMutate: () => queryClient.setQueryData(reviewKey, null),
  });

  const seatsLeft = scores.data?.wallets.find((candidate) => candidate.address === wallet.address)?.seatsLeft ?? null;
  // Hold announcements back until the dismissed list loads, so a dismissed one never flashes.
  const notice = pickNotice({
    seatsLeft,
    seatsSeen: seatsSeen.data?.[wallet.id],
    announcements: dismissed.isPending ? [] : (announcements.data ?? []),
    dismissed: dismissed.data ?? [],
    review: review.data ?? null,
  });

  const dismiss = () => {
    if (notice?.kind === "invites" && seatsLeft !== null) markSeats.mutate({ walletId: wallet.id, seats: seatsLeft });
    else if (notice?.kind === "announcement") dismissAnnouncement.mutate(notice.announcement.id);
    else if (notice?.kind === "review") finishReview.mutate();
  };

  return { notice, dismiss };
}
