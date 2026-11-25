import {
  addressFromOwner,
  base64UrlToBytes,
  isHardwareWalletMethod,
  isValidArweaveAddress,
  isValidHardwareDevice,
  type HardwareDevice,
  type HardwareWalletMethod,
  type StoragePort,
  type Wallet,
  type WalletSummary,
} from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { dappError } from "../dapp-error";
import { ACTIVE_WALLET_ID_KEY } from "../storage-keys";
import { loadWallets } from "../stored-data";
import type { KeySession } from "./key-session";
import { saveWallets, toSummary } from "./wallet-records";
import { hasVaultPassword, loadSession } from "./wallet-session";

/** An RSA-4096 modulus, the only key size Arweave addresses are made from. */
const RSA_MODULUS_BYTES = 512;
const HARDWARE_METHOD_NAME: Record<HardwareWalletMethod, string> = {
  keystone: "Keystone",
  ledger: "Ledger",
};

/**
 * Adds a wallet whose key lives on a Keystone or Ledger. Only the public
 * key and device details are stored. No password is asked for, so a
 * vault that has one must already be unlocked: otherwise this would add
 * a wallet to a locked Gleam.
 */
export async function addHardwareWallet(
  storage: StoragePort,
  keySession: KeySession,
  req: {
    method: HardwareWalletMethod;
    publicKey: string;
    device: HardwareDevice;
    name?: string;
  },
): Promise<WalletSummary> {
  return keySession.withSessionLock(async () => {
    if (!isHardwareWalletMethod(req.method)) {
      throw new Error(dappError(`"${String(req.method)}" isn't a hardware wallet type.`));
    }
    if (!isValidHardwareDevice(req.device) || req.device.kind !== req.method) {
      throw new Error(userErrorMessage("deviceDetailsMismatch"));
    }
    let modulus: Uint8Array;
    try {
      modulus = base64UrlToBytes(req.publicKey);
    } catch {
      throw new Error(userErrorMessage("deviceKeyEncoding"));
    }
    if (modulus.length !== RSA_MODULUS_BYTES) {
      throw new Error(
        userErrorMessage("deviceKeyLength", { size: modulus.length, expected: RSA_MODULUS_BYTES }),
      );
    }

    const wallets = await loadWallets(storage);
    if (hasVaultPassword(wallets) && (await loadSession(storage, keySession, wallets)) === null) {
      throw new Error(userErrorMessage("unlockBeforeAddingHardware"));
    }

    const address = await addressFromOwner(req.publicKey);
    const existing = wallets.find((wallet) => wallet.address === address);
    if (existing) {
      throw new Error(userErrorMessage("addressInGleam", { name: existing.name }));
    }

    const label = HARDWARE_METHOD_NAME[req.method];
    const sameMethodCount = wallets.filter((wallet) => wallet.method === req.method).length;
    const name = req.name?.trim() || `${label} ${sameMethodCount + 1}`;
    const now = Date.now();
    const wallet: Wallet = {
      id: crypto.randomUUID(),
      address,
      name,
      method: req.method,
      publicKey: req.publicKey,
      createdAt: now,
      updatedAt: now,
      encryptedKeyfile: null,
      backupConfirmedAt: null,
      device: req.device,
    };

    wallets.push(wallet);
    await saveWallets(storage, wallets);
    await storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
    // loadSession lists every hardware wallet, so this adds the new one to
    // an unlocked session, or starts one for a vault without a password.
    await loadSession(storage, keySession, wallets);

    return toSummary(wallet);
  });
}

/**
 * Adds an address to follow, with no key. Like a hardware wallet it asks
 * for no password, so a vault that has one must already be unlocked.
 */
export async function addWatchWallet(
  storage: StoragePort,
  keySession: KeySession,
  req: { address: string; name?: string },
): Promise<WalletSummary> {
  return keySession.withSessionLock(async () => {
    const address = req.address.trim();
    if (!isValidArweaveAddress(address)) {
      throw new Error(userErrorMessage("invalidWatchAddress"));
    }

    const wallets = await loadWallets(storage);
    if (hasVaultPassword(wallets) && (await loadSession(storage, keySession, wallets)) === null) {
      throw new Error(userErrorMessage("unlockBeforeAddingWallet"));
    }
    const existing = wallets.find((wallet) => wallet.address === address);
    if (existing) {
      throw new Error(userErrorMessage("addressInGleam", { name: existing.name }));
    }

    const watchCount = wallets.filter((wallet) => wallet.method === "watch").length;
    const name = req.name?.trim() || `Watched ${watchCount + 1}`;
    const now = Date.now();
    const wallet: Wallet = {
      id: crypto.randomUUID(),
      address,
      name,
      method: "watch",
      publicKey: "",
      createdAt: now,
      updatedAt: now,
      encryptedKeyfile: null,
      backupConfirmedAt: null,
    };

    wallets.push(wallet);
    await saveWallets(storage, wallets);
    await storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
    await loadSession(storage, keySession, wallets);

    return toSummary(wallet);
  });
}

