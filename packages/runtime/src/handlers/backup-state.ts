import type { BackupStatus, StoragePort, VaultEnvelopeV2 } from "@gleam/core";
import { updateStored } from "../storage-update";
import { BACKUP_KEY, BACKUP_STATE_KEY } from "../storage-keys";

/** `local:backupKey`: which backup this install writes, and its key wrapped under the vault password. */
export interface StoredBackupKey {
  backupId: string;
  wrapped: VaultEnvelopeV2;
}

/** `local:backupState`: this install's side of the backup. Nothing here is secret. */
export interface BackupState {
  /** This install's id in the file. */
  writer: string;
  lastWriteAt: number | null;
  /** When the vault last changed with no write since, or null when the backup is current. */
  dirtyAt: number | null;
  problem: BackupStatus["problem"];
}

function isStoredBackupKey(value: unknown): value is StoredBackupKey {
  if (value === null || typeof value !== "object") return false;
  const { backupId, wrapped } = value as Record<string, unknown>;
  // `unwrapBackupKey` checks the envelope's fields; a malformed one reads as a failed unlock of the backup.
  return typeof backupId === "string" && backupId.length > 0 && wrapped !== null && typeof wrapped === "object";
}

function isTimeOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isBackupState(value: unknown): value is BackupState {
  if (value === null || typeof value !== "object") return false;
  const { writer, lastWriteAt, dirtyAt, problem } = value as Record<string, unknown>;
  return (
    typeof writer === "string" &&
    writer.length > 0 &&
    isTimeOrNull(lastWriteAt) &&
    isTimeOrNull(dirtyAt) &&
    (problem === null || problem === "signIn" || problem === "missing")
  );
}

export async function loadBackupKey(storage: StoragePort): Promise<StoredBackupKey | null> {
  const raw = await storage.get<unknown>(BACKUP_KEY);
  return isStoredBackupKey(raw) ? raw : null;
}

export async function loadBackupState(storage: StoragePort): Promise<BackupState | null> {
  const raw = await storage.get<unknown>(BACKUP_STATE_KEY);
  return isBackupState(raw) ? raw : null;
}

/** Changes the stored state. Does nothing when backup is off, so a late write can't turn it back on. */
export async function updateBackupState(storage: StoragePort, change: (state: BackupState) => BackupState): Promise<void> {
  await updateStored<BackupState>(storage, BACKUP_STATE_KEY, (raw) => (isBackupState(raw) ? change(raw) : undefined));
}
