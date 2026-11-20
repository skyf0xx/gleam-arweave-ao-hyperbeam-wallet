import type { Contact } from "../models/contact";
import {
  ACTIVE_WALLET_BACKUP_KEY,
  CONTACTS_BACKUP_KEY,
  WALLETS_BACKUP_KEY,
  WATCHED_TOKENS_BACKUP_PREFIX,
  walletsOf,
  type BackupData,
  type BackupDevice,
} from "./file";

/** `newer`'s items in their order, then `older`'s that `newer` lacks. A shared item is whichever `pick` keeps. */
function union<T>(older: readonly T[], newer: readonly T[], idOf: (item: T) => string, pick: (older: T, newer: T) => T): T[] {
  const olderById = new Map(older.map((item) => [idOf(item), item]));
  const seen = new Set<string>();
  const merged = newer.map((item) => {
    const id = idOf(item);
    seen.add(id);
    const other = olderById.get(id);
    return other === undefined ? item : pick(other, item);
  });
  return [...merged, ...older.filter((item) => !seen.has(idOf(item)))];
}

function listOf<T>(data: BackupData, key: string): T[] {
  const value = data[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Two devices' backups as one, with nothing lost: wallets and contacts by
 * address and added tokens by process id are the union of both sides, and
 * every other key is `newer`'s where it has one. A wallet or contact on
 * both sides is the copy changed last. Wallets match by address because
 * one key imported on two installs gets a different id on each.
 */
export function mergeBackupData(older: BackupData, newer: BackupData): BackupData {
  const merged: BackupData = { ...older, ...newer };

  const wallets = union(
    walletsOf(older),
    walletsOf(newer),
    (wallet) => wallet.address,
    (mine, theirs) => (mine.updatedAt > theirs.updatedAt ? mine : theirs),
  );
  if (wallets.length > 0) merged[WALLETS_BACKUP_KEY] = wallets;

  // The active wallet may be a copy the union dropped: point at the one kept.
  const active = merged[ACTIVE_WALLET_BACKUP_KEY];
  if (typeof active === "string" && !wallets.some((wallet) => wallet.id === active)) {
    const activeAddress = [...walletsOf(newer), ...walletsOf(older)].find((wallet) => wallet.id === active)?.address;
    const kept = wallets.find((wallet) => wallet.address === activeAddress);
    if (kept) merged[ACTIVE_WALLET_BACKUP_KEY] = kept.id;
  }

  const contacts = union(
    listOf<Contact>(older, CONTACTS_BACKUP_KEY),
    listOf<Contact>(newer, CONTACTS_BACKUP_KEY),
    (contact) => contact.address,
    (mine, theirs) => (mine.createdAt > theirs.createdAt ? mine : theirs),
  );
  if (contacts.length > 0) merged[CONTACTS_BACKUP_KEY] = contacts;

  for (const key of Object.keys(merged)) {
    if (!key.startsWith(WATCHED_TOKENS_BACKUP_PREFIX)) continue;
    merged[key] = union(listOf<string>(older, key), listOf<string>(newer, key), (id) => id, (_, theirs) => theirs);
  }
  return merged;
}

/** Every device's vault as one, the device that wrote last counting as newest. */
export function mergeBackupDevices(devices: Readonly<Record<string, BackupDevice>>): BackupData {
  return Object.values(devices)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .reduce<BackupData>((merged, device) => mergeBackupData(merged, device.data), {});
}
