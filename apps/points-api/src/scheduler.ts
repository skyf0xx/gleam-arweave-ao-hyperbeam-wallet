import type { Db } from "./db";
import { runSnapshot, type SnapshotOptions } from "./snapshot";

/** Arbitrary constant naming the snapshot's Postgres advisory lock. */
const SNAPSHOT_LOCK_ID = 0x61e4_0001;

/**
 * Checks for a missing daily snapshot on boot and then every
 * `intervalMs`. A run that a restart interrupts, or a day the service was
 * down at midnight, is picked up by the next check.
 */
export function startSnapshotScheduler(
  db: Db,
  options: SnapshotOptions & { intervalMs?: number; log?: (line: string) => void },
): () => void {
  const log = options.log ?? console.log;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await db.withLock(SNAPSHOT_LOCK_ID, () => runSnapshot(db, new Date(), options));
      if (summary) {
        log(
          `Snapshot ${summary.day}: ${summary.walletCount} wallets, ${summary.liveCount} live, ${summary.failedCount} failed`,
        );
      }
    } catch (error) {
      log(`Snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? 10 * 60_000);
  return () => clearInterval(timer);
}
