import {
  type BadgePort,
  type PointsMembership,
  type PointsScores,
  type PointsSeatsRecord,
  type PointsSharePrompt,
  type StoragePort,
} from "@gleam/core";
import { updateStored } from "../storage-update";
import { storedRecord, without } from "./points-records";

/** Ids of wallets whose founding reveal has been shown, as `{ [walletId]: true }`. */
export const POINTS_REVEAL_SEEN_KEY = "local:points:foundingRevealSeen";
/**
 * Ids of wallets that reached the claim step and haven't claimed or tapped
 * Not now, as `{ [walletId]: true }`. Kept in storage because the popup
 * closes on any link click, which would otherwise lose the step.
 */
export const POINTS_CLAIM_PENDING_KEY = "local:points:claimPending";
/** Named share prompts each wallet has dismissed or acted on, as `{ [walletId]: PointsSharePrompt[] }`. */
export const POINTS_SHARE_SEEN_KEY = "local:points:shareSeen";
/**
 * Per-wallet seat counts as `{ [walletId]: { seen, latest } }`. `seen` is
 * the count the member has been shown. Anything that shows a "new invite"
 * (the Points banner, the toolbar dot, the main-screen notice) compares
 * the server's count against it.
 */
export const POINTS_SEATS_SEEN_KEY = "local:points:seatsSeen";

const shareSeenOf = (raw: unknown) => storedRecord<PointsSharePrompt[]>(raw);
const seatsOf = (raw: unknown) => storedRecord<PointsSeatsRecord>(raw);

/** What each wallet has been shown, and the seat counts behind the toolbar dot. */
export class PointsSeen {
  constructor(
    private readonly storage: StoragePort,
    private readonly badge: BadgePort,
    private readonly getMemberships: () => Promise<Record<string, PointsMembership>>,
  ) {}

  async getClaimPending(): Promise<string[]> {
    return Object.keys(storedRecord(await this.storage.get<unknown>(POINTS_CLAIM_PENDING_KEY)));
  }

  async setClaimPending(req: { walletId: string; pending: boolean }): Promise<void> {
    await updateStored(this.storage, POINTS_CLAIM_PENDING_KEY, (stored) => {
      const next = storedRecord<true>(stored);
      if (req.pending) next[req.walletId] = true;
      else delete next[req.walletId];
      return next;
    });
  }

  async getRevealSeen(): Promise<string[]> {
    return Object.keys(storedRecord(await this.storage.get<unknown>(POINTS_REVEAL_SEEN_KEY)));
  }

  async markRevealSeen(req: { walletId: string }): Promise<void> {
    await updateStored(this.storage, POINTS_REVEAL_SEEN_KEY, (stored) => ({
      ...storedRecord(stored),
      [req.walletId]: true,
    }));
  }

  async getShareSeen(): Promise<Record<string, PointsSharePrompt[]>> {
    return this.readShareSeen();
  }

  async markShareSeen(req: { walletId: string; prompt: PointsSharePrompt }): Promise<void> {
    await updateStored(this.storage, POINTS_SHARE_SEEN_KEY, (raw) => {
      const seen = shareSeenOf(raw);
      const prompts = seen[req.walletId] ?? [];
      return prompts.includes(req.prompt) ? undefined : { ...seen, [req.walletId]: [...prompts, req.prompt] };
    });
  }

  async getSeatsSeen(): Promise<Record<string, number>> {
    return Object.fromEntries(Object.entries(await this.readSeats()).map(([walletId, record]) => [walletId, record.seen]));
  }

  async markSeatsSeen(req: { walletId: string; seats: number }): Promise<void> {
    const seats = await updateStored(this.storage, POINTS_SEATS_SEEN_KEY, (raw) => {
      const current = seatsOf(raw);
      return {
        ...current,
        [req.walletId]: { seen: req.seats, latest: Math.max(current[req.walletId]?.latest ?? 0, req.seats) },
      };
    });
    await this.updateBadge(seats ?? {});
  }

  /**
   * Compares the server's seat counts with what each member has been
   * shown. A wallet seen for the first time is recorded without a signal,
   * so existing members don't get a false "new invite". A lower count
   * (a seat was used) lowers `seen` too, so the seat that comes back
   * later reads as new. Wallets with no seat limit (Phase 2) are skipped.
   */
  async syncSeats(scores: PointsScores): Promise<void> {
    const memberships = await this.getMemberships();
    const seats = await updateStored(this.storage, POINTS_SEATS_SEEN_KEY, (raw) => {
      const next = seatsOf(raw);
      for (const [walletId, membership] of Object.entries(memberships)) {
        const latest = scores.wallets.find((wallet) => wallet.address === membership.address)?.seatsLeft;
        if (typeof latest !== "number") continue;
        const previous = next[walletId];
        next[walletId] = { seen: previous === undefined ? latest : Math.min(previous.seen, latest), latest };
      }
      return next;
    });
    await this.updateBadge(seats ?? {});
  }

  private async updateBadge(seats: Record<string, PointsSeatsRecord>): Promise<void> {
    await this.badge.setDot(Object.values(seats).some((record) => record.latest > record.seen));
  }

  private async readShareSeen(): Promise<Record<string, PointsSharePrompt[]>> {
    return shareSeenOf(await this.storage.get<unknown>(POINTS_SHARE_SEEN_KEY));
  }

  private async readSeats(): Promise<Record<string, PointsSeatsRecord>> {
    return seatsOf(await this.storage.get<unknown>(POINTS_SEATS_SEEN_KEY));
  }

  /**
   * A later rejoin is a new join: its prompts and seat count start over.
   */
  async forget(walletId: string): Promise<void> {
    await updateStored(this.storage, POINTS_SHARE_SEEN_KEY, (raw) => without(shareSeenOf(raw), walletId));
    const seats = await updateStored(this.storage, POINTS_SEATS_SEEN_KEY, (raw) => without(seatsOf(raw), walletId));
    await this.updateBadge(seats ?? {});
  }
}
