import type { AutoLockTimeout, JWKInterface } from "@gleam/core";
import { storagePort } from "../adapters/storage";

/**
 * Background-worker-local cache of decrypted signing key material for
 * currently-unlocked wallets, backed by the same memory-only,
 * never-written-to-disk, cleared-on-browser-close storage area
 * `wallet-lifecycle.ts`'s `Session.unlockedWalletIds` already uses (routed
 * to `chrome.storage.session` by `adapters/storage.ts`'s `session:` prefix).
 * A plain module-level `Map` here would not survive Chrome idle-evicting and
 * restarting the MV3 service worker, which happens independently of the
 * user's chosen auto-lock timeout; this storage area does survive that
 * restart, so this cache and `Session.unlockedWalletIds` can never disagree
 * about whether a wallet is unlocked. No plaintext key material is ever
 * written to `local:`/disk-backed storage — only to this session area.
 *
 * Every entry is read fresh from storage on each call: there is no
 * in-process cache layered on top, so a service-worker restart changes
 * nothing about what a caller observes.
 */
const KEY_PREFIX = "session:key:";
const CACHED_WALLET_IDS_KEY = "session:cachedWalletIds";

const AUTO_LOCK_TIMEOUT_MS: Record<AutoLockTimeout, number | null> = {
  never: null,
  immediate: 0,
  "5min": 5 * 60 * 1000,
  "1hr": 60 * 60 * 1000,
  "4hr": 4 * 60 * 60 * 1000,
};

interface CachedKey {
  jwk: JWKInterface;
  address: string;
}

async function trackWalletId(walletId: string): Promise<void> {
  const ids = (await storagePort.get<string[]>(CACHED_WALLET_IDS_KEY)) ?? [];
  if (!ids.includes(walletId)) {
    await storagePort.set(CACHED_WALLET_IDS_KEY, [...ids, walletId]);
  }
}

async function untrackWalletId(walletId: string): Promise<void> {
  const ids = (await storagePort.get<string[]>(CACHED_WALLET_IDS_KEY)) ?? [];
  await storagePort.set(
    CACHED_WALLET_IDS_KEY,
    ids.filter((id) => id !== walletId),
  );
}

/** Stores a wallet's decrypted signing key for the duration of the unlocked session. */
export async function cacheKey(walletId: string, jwk: JWKInterface, address: string): Promise<void> {
  await storagePort.set(`${KEY_PREFIX}${walletId}`, { jwk, address } satisfies CachedKey);
  await trackWalletId(walletId);
}

/** Returns a cached wallet's decrypted key, or `null` if it isn't (or is no longer) cached. */
export async function getCachedKey(walletId: string): Promise<CachedKey | null> {
  return storagePort.get<CachedKey>(`${KEY_PREFIX}${walletId}`);
}

export async function hasCachedKey(walletId: string): Promise<boolean> {
  return (await getCachedKey(walletId)) !== null;
}

/** Drops one wallet's cached key — e.g. `deleteWallet` removing a wallet that was cached. */
export async function removeCachedKey(walletId: string): Promise<void> {
  await storagePort.remove(`${KEY_PREFIX}${walletId}`);
  await untrackWalletId(walletId);
}

/** Wipes every cached key — every tracked wallet's key, not the rest of session storage. */
export async function clearKeyCache(): Promise<void> {
  const ids = (await storagePort.get<string[]>(CACHED_WALLET_IDS_KEY)) ?? [];
  await Promise.all(ids.map((id) => storagePort.remove(`${KEY_PREFIX}${id}`)));
  await storagePort.remove(CACHED_WALLET_IDS_KEY);
}

/**
 * Auto-lock is enforced lazily, on access, against `Session.lastActivityAt`
 * — rather than a `setTimeout`/`chrome.alarms` callback — because an MV3
 * service worker can be idle-killed and restarted at any point, silently
 * dropping any pending timer; a persisted `Session` timestamp checked on
 * the next real access survives that restart and still enforces the
 * user's chosen timeout, just not to-the-millisecond. `"immediate"` (0ms)
 * still allows the single call that just unlocked to proceed, since
 * `lastActivityAt` is refreshed at the moment of unlock/activity.
 */
export function isSessionExpired(lastActivityAt: number, autoLockTimeout: AutoLockTimeout): boolean {
  const timeoutMs = AUTO_LOCK_TIMEOUT_MS[autoLockTimeout];
  if (timeoutMs === null) return false;
  return Date.now() - lastActivityAt > timeoutMs;
}
