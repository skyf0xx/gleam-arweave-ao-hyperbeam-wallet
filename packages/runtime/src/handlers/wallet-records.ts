import type { StoragePort, Wallet, WalletSummary } from "@gleam/core";
import { ACTIVE_WALLET_ID_KEY, WALLETS_KEY } from "../storage-keys";

export function toSummary(wallet: Wallet): WalletSummary {
  return {
    id: wallet.id,
    address: wallet.address,
    name: wallet.name,
    method: wallet.method,
    publicKey: wallet.publicKey,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    backupConfirmedAt: wallet.backupConfirmedAt,
    ...(wallet.device ? { device: wallet.device } : {}),
  };
}

export async function saveWallets(storage: StoragePort, wallets: Wallet[]): Promise<void> {
  await storage.set(WALLETS_KEY, wallets);
}

export async function loadActiveWalletId(
  storage: StoragePort,
  wallets: Wallet[],
): Promise<string | null> {
  const raw = await storage.get<unknown>(ACTIVE_WALLET_ID_KEY);
  if (typeof raw !== "string") return null;
  // Range-check against the currently valid wallet set — a stale id
  // pointing at a deleted/malformed wallet is dropped, not trusted.
  return wallets.some((wallet) => wallet.id === raw) ? raw : null;
}
