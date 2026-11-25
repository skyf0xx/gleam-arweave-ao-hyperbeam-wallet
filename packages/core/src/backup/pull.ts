import {
  CONTACTS_BACKUP_KEY,
  SAVED_SITES_BACKUP_KEY,
  WALLETS_BACKUP_KEY,
  walletsOf,
  watchedTokensBackupKey,
  type BackupData,
  type BackupDevice,
  type BackupRemoved,
} from "./file";
import { isPlainRecord } from "../models/guards";

/**
 * What a sync adds to this install and what it records as removed here.
 * `add` holds, by storage key, only items this install lacks.
 */
export interface PullPlan {
  add: BackupData;
  removed: BackupRemoved;
}

/** The id an item of a pulled key is known by, or null for an item no guard would pass. */
export function pulledItemId(key: string, item: unknown): string | null {
  if (key === WALLETS_BACKUP_KEY || key === CONTACTS_BACKUP_KEY) {
    const address = (item as { address?: unknown } | null)?.address;
    return typeof address === "string" ? address : null;
  }
  return typeof item === "string" ? item : null;
}

function itemsOf(data: BackupData | undefined, key: string): unknown[] {
  const value = data?.[key];
  return Array.isArray(value) ? value : [];
}

function idsOf(data: BackupData | undefined, key: string): Set<string> {
  return new Set(itemsOf(data, key).flatMap((item) => pulledItemId(key, item) ?? []));
}

/** A device's removals, keeping only well-formed lists: the field is not checked when a body is read. */
export function removedOf(device: BackupDevice | undefined): BackupRemoved {
  const removed: unknown = device?.removed;
  if (!isPlainRecord(removed)) return {};
  return Object.fromEntries(
    Object.entries(removed).flatMap(([key, ids]) =>
      Array.isArray(ids) ? [[key, ids.filter((id): id is string => typeof id === "string")]] : [],
    ),
  );
}

/**
 * The items other installs hold that this one lacks. Only lists that grow
 * by adding are pulled (wallets, contacts, added tokens and saved sites);
 * settings, the active wallet and the passkey stay this device's own. An
 * item already here is left as it is, so a pull never replaces a wallet's
 * keyfile with one under another password.
 *
 * An item that was in `own` (this install's copy at its last write) and is
 * gone from `local` was removed here, so it is recorded and not pulled
 * back. A removal is kept while another copy still holds the item, and
 * dropped once none does or once it is back here.
 */
export function planPull(local: BackupData, own: BackupDevice | undefined, others: readonly BackupDevice[]): PullPlan {
  const newestFirst = [...others].sort((a, b) => b.updatedAt - a.updatedAt);
  const previouslyRemoved = removedOf(own);
  const add: BackupData = {};
  const removed: BackupRemoved = {};

  const plan = (key: string) => {
    const here = idsOf(local, key);
    const elsewhere = new Map<string, unknown>();
    for (const device of newestFirst) {
      for (const item of itemsOf(device.data, key)) {
        const id = pulledItemId(key, item);
        if (id !== null && !elsewhere.has(id)) elsewhere.set(id, item);
      }
    }
    const gone = new Set(previouslyRemoved[key] ?? []);
    for (const id of idsOf(own?.data, key)) gone.add(id);
    const kept = [...gone].filter((id) => !here.has(id) && elsewhere.has(id));
    if (kept.length > 0) removed[key] = kept;

    const skip = new Set([...here, ...kept]);
    const items = [...elsewhere].filter(([id]) => !skip.has(id)).map(([, item]) => item);
    if (items.length > 0) add[key] = items;
  };

  // Wallets are matched by address, and by id so two copies of one wallet never both land here.
  const localWalletIds = new Set(walletsOf(local).map((wallet) => wallet.id));
  plan(WALLETS_BACKUP_KEY);
  const pulledWallets = walletsOf(add).filter((wallet) => !localWalletIds.has(wallet.id));
  if (pulledWallets.length > 0) add[WALLETS_BACKUP_KEY] = pulledWallets;
  else delete add[WALLETS_BACKUP_KEY];

  plan(CONTACTS_BACKUP_KEY);
  plan(SAVED_SITES_BACKUP_KEY);
  // Added tokens follow the wallets this install will hold.
  for (const wallet of [...walletsOf(local), ...pulledWallets]) plan(watchedTokensBackupKey(wallet.address));
  return { add, removed };
}
