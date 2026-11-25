import {
  isKeylessWalletMethod,
  type Session,
  type StoragePort,
  type Wallet,
} from "@gleam/core";
import { isSessionExpired, isValidSession, SESSION_KEY, type KeySession } from "./key-session";
import { loadLockSettings } from "./lifecycle-settings";

/** Hardware and watch wallets need no decrypted key, so they are usable whenever Gleam is unlocked. */
export function keylessWalletIds(wallets: Wallet[]): string[] {
  return wallets.filter((wallet) => isKeylessWalletMethod(wallet.method)).map((wallet) => wallet.id);
}

/** A vault has a password exactly when some wallet holds a keyfile encrypted under it. */
export function hasVaultPassword(wallets: Wallet[]): boolean {
  return wallets.some((wallet) => wallet.encryptedKeyfile !== null);
}

/**
 * Reads back the unlocked session, treating one whose auto-lock timeout
 * has elapsed as no different from an explicit `lockWallet()` — same
 * "stays unlocked until you lock it or this timeout is reached" contract
 * `LockSettingsView` already advertises. Clears the in-memory key cache
 * on the same path so an expired session can never be used to sign even
 * if some caller reached a handler method without going through
 * `getState` first.
 *
 * Hardware and watch wallets have no key to cache, so every one of them
 * is listed whenever the session exists. A vault holding only those has
 * no password to unlock with, so it always has a session and never
 * auto-locks.
 */
export async function loadSession(
  storage: StoragePort,
  keySession: KeySession,
  wallets: Wallet[],
): Promise<Session | null> {
  const raw = await storage.get<unknown>(SESSION_KEY);
  const keylessIds = keylessWalletIds(wallets);

  if (!hasVaultPassword(wallets)) {
    if (keylessIds.length === 0) return null;
    if (isValidSession(raw) && sameIds(raw.unlockedWalletIds, keylessIds)) return raw;
    const now = Date.now();
    const session: Session = isValidSession(raw)
      ? { ...raw, unlockedWalletIds: keylessIds }
      : {
          unlockedAt: now,
          lastActivityAt: now,
          autoLockTimeout: (await loadLockSettings(storage)).autoLockTimeout,
          unlockedWalletIds: keylessIds,
        };
    await saveSession(storage, session);
    return session;
  }

  if (!isValidSession(raw)) return null;
  if (isSessionExpired(raw.lastActivityAt, raw.autoLockTimeout)) {
    await lockSession(storage, keySession);
    return null;
  }
  // Filter unlockedWalletIds against the current wallet set, same
  // untrusted-input treatment as activeWalletId.
  const knownIds = raw.unlockedWalletIds.filter(
    (id) => wallets.some((wallet) => wallet.id === id) && !keylessIds.includes(id),
  );
  // A wallet whose key is gone can't sign, so it is locked whatever the
  // session record says. Persist the pruned list so getCachedKey and the
  // UI agree. Hardware and watch wallets alone never keep a
  // password-protected vault unlocked.
  const keyPresent = await Promise.all(knownIds.map((id) => keySession.isKeyStored(id)));
  const keyedIds = knownIds.filter((_, index) => keyPresent[index]);
  if (keyedIds.length === 0) {
    await lockSession(storage, keySession);
    return null;
  }
  const validIds = [...keyedIds, ...keylessIds];
  if (sameIds(raw.unlockedWalletIds, validIds)) return raw;
  const session = { ...raw, unlockedWalletIds: validIds };
  await saveSession(storage, session);
  return session;
}

/**
 * Ends the session even when wiping the keys fails, then rethrows: every
 * wallet must read as locked, and the caller must still learn the keyring
 * may still hold keys.
 */
export async function lockSession(storage: StoragePort, keySession: KeySession): Promise<void> {
  try {
    await keySession.clearKeyCache();
  } finally {
    await saveSession(storage, null);
  }
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

export async function saveSession(storage: StoragePort, session: Session | null): Promise<void> {
  if (session === null) {
    await storage.remove(SESSION_KEY);
    return;
  }
  // eslint-disable-next-line gleam/no-storage-read-modify-write -- callers hold withSessionLock, so no other update of the session interleaves
  await storage.set(SESSION_KEY, session);
}
