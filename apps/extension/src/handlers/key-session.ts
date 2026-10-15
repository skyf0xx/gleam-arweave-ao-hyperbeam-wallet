import {
  isHardwareWalletMethod,
  signerFromJwk,
  type AutoLockTimeout,
  type HardwareDevice,
  type JWKInterface,
  type Session,
  type Signer,
  type WalletMethod,
} from "@gleam/core";
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
/** Written by `wallet-lifecycle.ts`; read here so every key read can enforce auto-lock. */
export const SESSION_KEY = "session:unlockedSession";
/** Written by `wallet-lifecycle.ts`; read here to tell a hardware wallet from a locked one. */
export const WALLETS_KEY = "local:wallets";

/**
 * Thrown instead of reporting "locked" when a caller asks for the key of
 * a hardware wallet: there is no key to unlock, and telling the user to
 * unlock would send them in a circle.
 */
export class HardwareWalletSigningError extends Error {
  constructor() {
    super("This wallet signs on its device. Signing with a hardware wallet isn't supported yet.");
    this.name = "HardwareWalletSigningError";
  }
}

export interface StoredWalletInfo {
  id: string;
  address: string;
  method: WalletMethod;
  publicKey: string;
  /** Present on hardware wallets. */
  device?: HardwareDevice;
}

/** The public fields of a stored wallet, or null when no wallet has this id. */
export async function getStoredWallet(walletId: string): Promise<StoredWalletInfo | null> {
  const wallets = await storagePort.get<unknown>(WALLETS_KEY);
  if (!Array.isArray(wallets)) return null;
  const wallet = (wallets as unknown[]).find(
    (candidate): candidate is Record<string, unknown> =>
      candidate !== null && typeof candidate === "object" && (candidate as { id?: unknown }).id === walletId,
  );
  if (!wallet) return null;
  const { address, method, publicKey, device } = wallet;
  if (typeof address !== "string" || typeof method !== "string" || typeof publicKey !== "string") return null;
  const info: StoredWalletInfo = { id: walletId, address, method: method as WalletMethod, publicKey };
  if (device !== null && typeof device === "object") info.device = device as HardwareDevice;
  return info;
}

/** The stored wallet's method, or null when no wallet has this id. */
export async function getWalletMethod(walletId: string): Promise<WalletMethod | null> {
  return (await getStoredWallet(walletId))?.method ?? null;
}

async function isHardwareWallet(walletId: string): Promise<boolean> {
  const method = await getWalletMethod(walletId);
  return method !== null && isHardwareWalletMethod(method);
}

const AUTO_LOCK_TIMEOUT_MS: Record<AutoLockTimeout, number | null> = {
  never: null,
  immediate: 60 * 1000,
  "5min": 5 * 60 * 1000,
  "1hr": 60 * 60 * 1000,
  "4hr": 4 * 60 * 60 * 1000,
};

interface CachedKey {
  jwk: JWKInterface;
  address: string;
}

/**
 * `zeroize()` (core/vault/zeroize.ts) operates on byte buffers; a
 * `CachedKey` holds its key material as base64url strings (arweave-js's
 * `JWKInterface` shape), and `StoragePort` has no in-place overwrite —
 * only `set`/`remove`. So "zeroize before removal" here means: overwrite
 * the stored record with an all-zero same-shape record via `set`, then
 * `remove` it, rather than deleting straight away and leaving whatever
 * plaintext the underlying storage backend hasn't yet reclaimed.
 */
function zeroizedCachedKey(entry: CachedKey): CachedKey {
  const zeroedJwk = Object.fromEntries(
    Object.entries(entry.jwk).map(([field, value]) => [field, "0".repeat(value.length)]),
  ) as unknown as JWKInterface;
  return { jwk: zeroedJwk, address: "0".repeat(entry.address.length) };
}

async function zeroizeAndRemove(walletId: string): Promise<void> {
  const key = `${KEY_PREFIX}${walletId}`;
  const entry = await storagePort.get<CachedKey>(key);
  if (entry) {
    await storagePort.set(key, zeroizedCachedKey(entry));
  }
  await storagePort.remove(key);
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

export function isValidSession(value: unknown): value is Session {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.unlockedAt === "number" &&
    typeof candidate.lastActivityAt === "number" &&
    typeof candidate.autoLockTimeout === "string" &&
    Object.hasOwn(AUTO_LOCK_TIMEOUT_MS, candidate.autoLockTimeout) &&
    Array.isArray(candidate.unlockedWalletIds) &&
    candidate.unlockedWalletIds.every((id) => typeof id === "string")
  );
}

/**
 * Returns a cached wallet's decrypted key, or `null` if the wallet is
 * locked. Handlers read keys without going through `getState`, so the
 * auto-lock timeout is enforced here too: an expired session wipes every
 * cached key and the session record before anything can sign with them.
 * A key with no session listing its wallet is treated as locked. Throws
 * `HardwareWalletSigningError` for a hardware wallet, which never has a
 * key here. Not exported: the key leaves this module only as a `Signer`.
 */
async function getCachedKey(walletId: string): Promise<CachedKey | null> {
  if (await isHardwareWallet(walletId)) throw new HardwareWalletSigningError();
  const session = await storagePort.get<unknown>(SESSION_KEY);
  if (!isValidSession(session)) return null;
  if (isSessionExpired(session.lastActivityAt, session.autoLockTimeout)) {
    await clearKeyCache();
    await storagePort.remove(SESSION_KEY);
    return null;
  }
  if (!session.unlockedWalletIds.includes(walletId)) return null;
  return storagePort.get<CachedKey>(`${KEY_PREFIX}${walletId}`);
}

/**
 * A signer for an unlocked wallet, or `null` if it is locked. Same
 * auto-lock and hardware-wallet rules as every key read here.
 */
export async function getSigner(walletId: string): Promise<Signer | null> {
  const cached = await getCachedKey(walletId);
  return cached ? signerFromJwk(cached.jwk, cached.address) : null;
}

export async function hasCachedKey(walletId: string): Promise<boolean> {
  return (await getCachedKey(walletId)) !== null;
}

/**
 * Drops one wallet's cached key — e.g. `deleteWallet` removing a wallet
 * that was cached. Zeroizes the stored JWK's string fields before
 * removing the entry (SIGNING-KEY-ZEROIZATION-RULE-1) rather than
 * deleting it outright.
 */
export async function removeCachedKey(walletId: string): Promise<void> {
  await zeroizeAndRemove(walletId);
  await untrackWalletId(walletId);
}

/**
 * Wipes every cached key — every tracked wallet's key, not the rest of
 * session storage. Zeroizes each entry's JWK string fields before
 * removal (SIGNING-KEY-ZEROIZATION-RULE-1), same as `removeCachedKey`.
 */
export async function clearKeyCache(): Promise<void> {
  const ids = (await storagePort.get<string[]>(CACHED_WALLET_IDS_KEY)) ?? [];
  await Promise.all(ids.map((id) => zeroizeAndRemove(id)));
  await storagePort.remove(CACHED_WALLET_IDS_KEY);
}

/**
 * Whether a key entry exists for this wallet, regardless of session state.
 * `wallet-lifecycle.ts` uses it to report a wallet as locked when its key
 * is missing, so the UI never shows "unlocked" for a wallet that can't sign.
 */
export async function isKeyStored(walletId: string): Promise<boolean> {
  return (await storagePort.get<CachedKey>(`${KEY_PREFIX}${walletId}`)) !== null;
}

/**
 * Auto-lock is enforced lazily, on access, against `Session.lastActivityAt`
 * — rather than a `setTimeout`/`chrome.alarms` callback — because an MV3
 * service worker can be idle-killed and restarted at any point, silently
 * dropping any pending timer; a persisted `Session` timestamp checked on
 * the next real access survives that restart and still enforces the
 * user's chosen timeout, just not to-the-millisecond. `"immediate"` locks one minute after the
 * last activity rather than at 0ms — a literal 0ms timeout would lock the
 * wallet the moment it's unlocked, before anything can ever sign with it.
 */
export function isSessionExpired(lastActivityAt: number, autoLockTimeout: AutoLockTimeout): boolean {
  const timeoutMs = AUTO_LOCK_TIMEOUT_MS[autoLockTimeout];
  if (timeoutMs === null) return false;
  return Date.now() - lastActivityAt > timeoutMs;
}
