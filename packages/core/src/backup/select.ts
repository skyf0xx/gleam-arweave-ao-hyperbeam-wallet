import type { StoragePort } from "../ports/storage";
import {
  ACTIVE_WALLET_BACKUP_KEY,
  BACKUP_KEYS,
  backupValueOf,
  isBackedUpKey,
  isValidBackupData,
  walletsOf,
  watchedTokensBackupKey,
  type BackupData,
} from "./file";

/** Reads everything a backup carries out of storage. */
export async function readBackupData(storage: StoragePort): Promise<BackupData> {
  const data: BackupData = {};
  const read = async (key: string): Promise<void> => {
    const value = backupValueOf(key, await storage.get<unknown>(key));
    if (value !== undefined) data[key] = value;
  };
  await Promise.all(BACKUP_KEYS.map(read));
  const wallets = walletsOf(data);
  // `StoragePort` can't list keys, so the per-wallet keys are found through the wallets.
  await Promise.all(wallets.map((wallet) => read(watchedTokensBackupKey(wallet.address))));
  if (!wallets.some((wallet) => wallet.id === data[ACTIVE_WALLET_BACKUP_KEY])) delete data[ACTIVE_WALLET_BACKUP_KEY];
  return data;
}

/**
 * Writes a restored backup into storage in one atomic step, or throws
 * with nothing written when any value fails its guard.
 */
export async function writeBackupData(storage: StoragePort, data: BackupData): Promise<void> {
  if (!isValidBackupData(data)) throw new Error("This backup holds data Gleam can't read.");
  await storage.setMany(Object.fromEntries(Object.entries(data).filter(([key]) => isBackedUpKey(key))));
}
