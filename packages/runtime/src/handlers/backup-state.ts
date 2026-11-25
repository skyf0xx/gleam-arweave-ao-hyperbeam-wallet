import { z } from "zod";
import { isRecord, type BackupStatus, type StoragePort, type VaultEnvelopeV2 } from "@gleam/core";
import { updateStored } from "../storage-update";
import { schemaGuard } from "../schema-guard";
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

// `unwrapBackupKey` checks the envelope's fields; a malformed one reads as a failed unlock of the backup.
const isStoredBackupKey = schemaGuard<StoredBackupKey>(
  z.object({ backupId: z.string().min(1), wrapped: z.unknown().refine(isRecord) }),
);

const timeOrNull = z.number().nullable();

const isBackupState = schemaGuard<BackupState>(
  z.object({
    writer: z.string().min(1),
    lastWriteAt: timeOrNull,
    dirtyAt: timeOrNull,
    problem: z.enum(["signIn", "missing", "otherPassword"]).nullable(),
  }),
);

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
