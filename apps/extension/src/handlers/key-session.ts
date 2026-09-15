import type { AutoLockTimeout, JWKInterface } from "@gleam/core";

/**
 * In-memory, background-worker-local cache of decrypted signing key
 * material for currently-unlocked wallets. This is the piece
 * `wallet-lifecycle.ts` originally decided not to build (its doc comment's
 * "Session-state decision": a derived key isn't structured-cloneable into
 * `chrome.storage.session`, so it held no key material across calls at
 * all). That made every signing call require a freshly-typed password,
 * which is the thing this rework removes: once unlocked, Gleam stays
 * unlocked — no further password prompts — until `clear()` (explicit
 * "Lock now") or `isExpired()` (the user's chosen auto-lock timeout, same
 * shape as Rabby's) says otherwise. Lives here, not in `packages/core`,
 * because it's process-lifetime state tied to this one service-worker
 * instance, never serialized or ported anywhere.
 *
 * A service-worker restart empties this map — nothing here survives that
 * (the JWK plaintext never touches storage). `Session.unlockedWalletIds`
 * (in `chrome.storage.session`) surviving a restart while this cache is
 * empty is exactly the "looks unlocked but has no key" gap the original
 * doc comment flagged; callers that find a wallet id missing from this
 * cache despite an unlocked `Session` should surface a "re-enter your
 * password" prompt rather than fail silently — the same experience a
 * killed-and-restarted MV3 worker forces on every wallet extension, not a
 * regression introduced here.
 */
const keyCache = new Map<string, { jwk: JWKInterface; address: string }>();

const AUTO_LOCK_TIMEOUT_MS: Record<AutoLockTimeout, number | null> = {
  never: null,
  immediate: 0,
  "5min": 5 * 60 * 1000,
  "1hr": 60 * 60 * 1000,
  "4hr": 4 * 60 * 60 * 1000,
};

/** Stores a wallet's decrypted signing key for the duration of the unlocked session. */
export function cacheKey(walletId: string, jwk: JWKInterface, address: string): void {
  keyCache.set(walletId, { jwk, address });
}

/** Returns a cached wallet's decrypted key, or `null` if it isn't (or is no longer) cached. */
export function getCachedKey(walletId: string): { jwk: JWKInterface; address: string } | null {
  return keyCache.get(walletId) ?? null;
}

export function hasCachedKey(walletId: string): boolean {
  return keyCache.has(walletId);
}

/** Drops one wallet's cached key — e.g. `deleteWallet` removing a wallet that was cached. */
export function removeCachedKey(walletId: string): void {
  keyCache.delete(walletId);
}

/**
 * Wipes every cached key. `JWKInterface`'s private-exponent field is a
 * string, not a byte buffer — unlike `decryptFromEnvelope`'s raw plaintext,
 * a JS string can't be overwritten in place, so this can only drop every
 * reference and let GC reclaim the memory, same as every password string
 * already held in component state elsewhere in this codebase.
 */
export function clearKeyCache(): void {
  keyCache.clear();
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
