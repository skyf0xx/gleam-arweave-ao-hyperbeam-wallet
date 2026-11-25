import { isValidWallet, type StoragePort, type Wallet } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { WALLETS_KEY } from "./storage-keys";
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
