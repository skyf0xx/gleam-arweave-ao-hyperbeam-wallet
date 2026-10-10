import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Announcement, RuntimePort, WalletSummary } from "@gleam/core";
import { FOUNDING_GATE } from "@/src/founding-gate";
import {
  useMarkSeatsSeen,
  usePointsMemberships,
  usePointsScores,
  usePointsSeatsSeen,
} from "../../points/src/usePoints";
import { pickNotice, type Notice } from "./notice";

const ANNOUNCEMENTS_STALE_MS = 60 * 60_000;
const announcementKeys = {
  list: () => ["announcements", "list"] as const,
  dismissed: () => ["announcements", "dismissed"] as const,
};

export interface UseNotice {
  notice: Notice | null;
  /** Dismissing the invite notice records the seats as seen, same as opening Points. */
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

  const seatsLeft = scores.data?.wallets.find((candidate) => candidate.address === wallet.address)?.seatsLeft ?? null;
  // Hold announcements back until the dismissed list loads, so a dismissed one never flashes.
  const notice = pickNotice({
    seatsLeft,
    seatsSeen: seatsSeen.data?.[wallet.id],
    announcements: dismissed.isPending ? [] : (announcements.data ?? []),
    dismissed: dismissed.data ?? [],
  });

  const dismiss = () => {
    if (notice?.kind === "invites" && seatsLeft !== null) markSeats.mutate({ walletId: wallet.id, seats: seatsLeft });
    else if (notice?.kind === "announcement") dismissAnnouncement.mutate(notice.announcement.id);
  };

  return { notice, dismiss };
}
