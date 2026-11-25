import { isRecord, isValidWallet, type ActivityEntry, type StoragePort, type Wallet } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { ACTIVITY_LOG_KEY_PREFIX, WALLETS_KEY } from "./storage-keys";
import { updateStored } from "./storage-update";

/** The valid wallets in a stored value; a record that fails the guard is dropped, never repaired. */
export function parseWallets(raw: unknown): Wallet[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidWallet).map((wallet) => ({
    ...wallet,
    // Records stored before this field existed lack it.
    backupConfirmedAt: wallet.backupConfirmedAt ?? null,
  }));
}

export async function loadWallets(storage: StoragePort): Promise<Wallet[]> {
  return parseWallets(await storage.get<unknown>(WALLETS_KEY));
}

/** Also takes the wallet summaries `getState` returns. */
export function requireWallet<T extends { id: string }>(wallets: readonly T[], walletId: string): T {
  const wallet = wallets.find((candidate) => candidate.id === walletId);
  if (!wallet) throw new Error(userErrorMessage("noStoredWallet", { wallet: walletId }));
  return wallet;
}

/** Merges `patch` into one stored wallet, queued with every other write of the wallet list. */
export async function updateWallet(storage: StoragePort, walletId: string, patch: Partial<Wallet>): Promise<void> {
  await updateStored(storage, WALLETS_KEY, (raw) => {
    const wallets = parseWallets(raw);
    const wallet = requireWallet(wallets, walletId);
    return wallets.map((candidate) => (candidate === wallet ? { ...wallet, ...patch } : candidate));
  });
}

export function isValidActivityEntry(value: unknown): value is ActivityEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.txId === "string" &&
    (value.type === "send" || value.type === "receive" || value.type === "upload") &&
    (value.status === "pending" || value.status === "confirmed" || value.status === "failed") &&
    typeof value.address === "string" &&
    (value.amount === null || typeof value.amount === "string") &&
    Array.isArray(value.tags) &&
    typeof value.timestamp === "number" &&
    (value.error === undefined || value.error === null || typeof value.error === "string") &&
    (value.dataSize === undefined || typeof value.dataSize === "string")
  );
}

export function activityLogKey(address: string): string {
  return `${ACTIVITY_LOG_KEY_PREFIX}${address}`;
}

export function parseActivityLog(raw: unknown): ActivityEntry[] {
  return Array.isArray(raw) ? raw.filter(isValidActivityEntry) : [];
}

export async function loadActivityLog(storage: StoragePort, address: string): Promise<ActivityEntry[]> {
  return parseActivityLog(await storage.get<unknown>(activityLogKey(address)));
}
