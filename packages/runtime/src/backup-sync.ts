import { BACKUP_KEYS, isValidWallet, watchedTokensBackupKey, type StoragePort, type TimerPort } from "@gleam/core";
import type { BackupHandler } from "./handlers/backup";
import { WALLETS_KEY } from "./storage-keys";

export const BACKUP_SYNC_ALARM_NAME = "gleam-backup-sync";

/** Long enough for the writes of one action (a new wallet and its active id) to land as one backup. */
const DEBOUNCE_MS = 5_000;

export interface BackupSyncOptions {
  debounceMs?: number;
  schedule?: (run: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Keeps the backup current: a change to anything it holds is recorded,
 * then written a few seconds later. The minute tick writes what the
 * debounce couldn't, such as a change made while Gleam was locked or one
 * whose timer a stopped worker dropped.
 */
export function registerBackupSync(
  storage: StoragePort,
  timer: TimerPort,
  backup: BackupHandler,
  {
    debounceMs = DEBOUNCE_MS,
    schedule = (run, delayMs) => setTimeout(run, delayMs),
    cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }: BackupSyncOptions = {},
): void {
  const sync = () => {
    backup.sync().catch((error: unknown) => console.error("Vault backup failed.", error));
  };

  let pending: unknown = null;
  const changed = () => {
    void backup
      .markChanged()
      .catch((error: unknown) => console.error("Couldn't record a vault change for the backup.", error));
    if (pending !== null) cancel(pending);
    pending = schedule(() => {
      pending = null;
      sync();
    }, debounceMs);
  };

  for (const key of BACKUP_KEYS) storage.watch(key, changed);

  // The added-token keys are per wallet, so they are watched as wallets come and go.
  const tokenWatches = new Map<string, () => void>();
  const watchTokens = (wallets: unknown) => {
    const keys = new Set(
      (Array.isArray(wallets) ? wallets : []).filter(isValidWallet).map((wallet) => watchedTokensBackupKey(wallet.address)),
    );
    for (const [key, unwatch] of tokenWatches) {
      if (keys.has(key)) continue;
      unwatch();
      tokenWatches.delete(key);
    }
    for (const key of keys) {
      if (!tokenWatches.has(key)) tokenWatches.set(key, storage.watch(key, changed));
    }
  };
  storage.watch<unknown>(WALLETS_KEY, watchTokens);
  void storage.get<unknown>(WALLETS_KEY).then(watchTokens, () => {});

  timer.every(BACKUP_SYNC_ALARM_NAME, 1, sync);
}
