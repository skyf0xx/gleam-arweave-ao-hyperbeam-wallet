import type { ActivityEntry, ReviewMoment, StoragePort, Wallet } from "@gleam/core";

/** `true` once the review prompt was answered or dismissed. Per install, not per wallet. */
export const REVIEW_PROMPT_DONE_KEY = "local:reviewPrompt:done";

const WALLETS_KEY = "local:wallets";
const ACTIVITY_LOG_KEY_PREFIX = "local:activityLog:";

/** How long Gleam has been in use before a quiet user is asked anyway. */
export const SETTLED_AFTER_MS = 14 * 24 * 60 * 60_000;

export interface ReviewPromptHandlerDeps {
  storage: StoragePort;
  now?: () => number;
}

/**
 * Asks for a store review once, after a good moment. The moments are read
 * from what's already stored rather than recorded as they happen: the
 * local activity log holds only this wallet's own sends, so a
 * confirmed entry there is one the user made and saw land.
 */
export class ReviewPromptHandler {
  private readonly now: () => number;

  constructor(private readonly deps: ReviewPromptHandlerDeps) {
    this.now = deps.now ?? Date.now;
  }

  async get({ since }: { since: number }): Promise<ReviewMoment | null> {
    if ((await this.deps.storage.get<unknown>(REVIEW_PROMPT_DONE_KEY)) === true) return null;
    const raw = await this.deps.storage.get<unknown>(WALLETS_KEY);
    const wallets = Array.isArray(raw) ? (raw as Wallet[]) : [];
    if (wallets.length === 0) return null;

    const logs = await Promise.all(
      [...new Set(wallets.map((wallet) => wallet.address))].map(async (address) => {
        const log = await this.deps.storage.get<unknown>(`${ACTIVITY_LOG_KEY_PREFIX}${address}`);
        return Array.isArray(log) ? (log as ActivityEntry[]) : [];
      }),
    );
    const landed = logs
      .flat()
      .filter((entry) => entry.status === "confirmed" && entry.timestamp < since && entry.type === "send")
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (landed) return { kind: "send" };

    const hardware = wallets.find((wallet) => wallet.createdAt < since && (wallet.method === "ledger" || wallet.method === "keystone"));
    if (hardware) return { kind: "hardware", device: hardware.method === "ledger" ? "Ledger" : "Keystone" };

    const firstUse = Math.min(...wallets.map((wallet) => wallet.createdAt));
    return this.now() - firstUse >= SETTLED_AFTER_MS ? { kind: "settled" } : null;
  }

  async finish(): Promise<void> {
    await this.deps.storage.set(REVIEW_PROMPT_DONE_KEY, true);
  }
}
