import {
  isHardwareWalletMethod,
  signerFromKeyStore,
  vaultHasPassword,
  type AutoLockTimeout,
  type HardwareDevice,
  type JWKInterface,
  type Session,
  type Signer,
  type WalletMethod,
} from "@gleam/core";
import { sessionKeyStore } from "../adapters/session-key-store";
import { storagePort } from "../adapters/storage";

/**
 * The signing keys of currently-unlocked wallets, held in two places:
 *
 * - Non-extractable `CryptoKey`s (one RSA-PSS key per hash, one RSA-OAEP
 *   key) in the keyring offscreen document, via `sessionKeyStore`. They
 *   exist only in that document's memory: nothing key-related is written
 *   to disk. Extension code can ask the keyring to sign or decrypt but
 *   can't read the key.
 * - A `session:key:<walletId>` entry in `chrome.storage.session` with only
 *   the address and the public modulus.
 *
 * A wallet counts as unlocked only when the session lists it, its entry
 * exists and the keyring holds its key. Both stores outlive the MV3
 * service worker's idle shutdown, so a worker restart never locks a
 * wallet behind the user's back. If the keyring document is gone (Chrome
 * closed it, or it crashed), its wallets read as locked and the user
 * unlocks again.
 *
 * Unlock, lock and auto-lock each read and write both stores in several
 * steps, so they run one at a time through `withSessionLock`. Otherwise a
 * lock landing mid-unlock could leave keys behind or an unlock could
 * revive a session that was just locked.
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

/**
 * The keyring refused an unlocked key. Distinct from a wrong password, so
 * the user isn't told to retype a password that was right.
 */
export class SessionKeyStorageError extends Error {
  constructor(cause: unknown) {
    super("Gleam couldn't keep the wallet unlocked. Restart the browser and try again.", {
      cause,
    });
    this.name = "SessionKeyStorageError";
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

/** What `chrome.storage.session` holds per unlocked wallet; the private key itself is in `sessionKeyStore`. */
interface SessionKeyEntry {
  address: string;
  owner: string;
}

function entryKey(walletId: string): string {
  return `${KEY_PREFIX}${walletId}`;
}

/**
 * Exactly `{ address, owner }`. Any extra field, such as the `d` or whole
 * JWK older releases stored here, marks an old entry that may hold
 * private key material.
 */
function isSessionKeyEntry(value: unknown): value is SessionKeyEntry {
  if (value === null || typeof value !== "object") return false;
  const { address, owner } = value as Record<string, unknown>;
  return typeof address === "string" && typeof owner === "string" && Object.keys(value).length === 2;
}

/**
 * `zeroize()` (core/vault/zeroize.ts) operates on byte buffers, but these
 * entries hold base64url strings and `StoragePort` has no in-place
 * overwrite. So "zeroize before removal" means: overwrite the record with
 * a same-shape all-zero copy via `set`, then `remove` it, rather than
 * leaving plaintext the storage backend hasn't yet reclaimed. Recursive so
 * it also scrubs entries written in an older shape.
 */
function zeroStrings(value: unknown): unknown {
  if (typeof value === "string") return "0".repeat(value.length);
  if (Array.isArray(value)) return value.map(zeroStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([field, inner]) => [field, zeroStrings(inner)]));
  }
  return value;
}

async function zeroizeAndRemoveEntry(walletId: string): Promise<void> {
  const key = entryKey(walletId);
  const entry = await storagePort.get<unknown>(key);
  if (entry !== null) {
    await storagePort.set(key, zeroStrings(entry));
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

let sessionQueue: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` after every earlier one has settled. Not re-entrant: a task
 * must not call anything that takes this lock itself.
 */
export function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
  const result = sessionQueue.then(task);
  sessionQueue = result.catch(() => undefined);
  return result;
}

/**
 * Hands a wallet's decrypted keyfile to the keyring for the duration of
 * the unlocked session. Nothing here keeps a reference to `jwk`; the
 * caller's parsed copy stays in this worker's memory until garbage
 * collection. Callers hold `withSessionLock`.
 */
export async function cacheKey(walletId: string, jwk: JWKInterface, address: string): Promise<void> {
  if (!jwk.d) throw new Error("This keyfile has no private key.");
  try {
    await sessionKeyStore.importKey(walletId, jwk);
    await storagePort.set(entryKey(walletId), { address, owner: jwk.n } satisfies SessionKeyEntry);
    await trackWalletId(walletId);
  } catch (error) {
    throw new SessionKeyStorageError(error);
  }
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
 * A wallet's session entry when the keyring also holds its key,
 * regardless of session state; null when either half is missing. An
 * entry in any other shape (such as the JWK or `d` older releases stored
 * here) is scrubbed and reported as locked.
 */
async function readStoredKey(walletId: string): Promise<SessionKeyEntry | null> {
  const entry = await storagePort.get<unknown>(entryKey(walletId));
  if (entry === null) return null;
  // A failed keyring call here must not fail `getState`, or the popup
  // can't even open to show the wallet as locked.
  if (!isSessionKeyEntry(entry)) {
    await removeCachedKey(walletId).catch((error: unknown) => {
      console.error("Couldn't remove an old-format session key.", error);
    });
    return null;
  }
  try {
    return (await sessionKeyStore.has([walletId])).includes(walletId) ? entry : null;
  } catch (error) {
    console.error("Couldn't reach the keyring; treating the wallet as locked.", error);
    return null;
  }
}

/**
 * A vault of only hardware wallets has no password to unlock with, so
 * `wallet-lifecycle.ts`'s `loadSession` keeps its session open and never
 * auto-locks it. Matched here so the alarm doesn't end a session that
 * `loadSession` would only start again.
 */
async function isHardwareOnlyVault(): Promise<boolean> {
  const wallets = await storagePort.get<unknown>(WALLETS_KEY);
  if (!Array.isArray(wallets)) return false;
  const methods = (wallets as unknown[]).flatMap((wallet) => {
    const method = wallet !== null && typeof wallet === "object" ? (wallet as { method?: unknown }).method : undefined;
    return typeof method === "string" ? [{ method: method as WalletMethod }] : [];
  });
  return methods.length > 0 && !vaultHasPassword(methods);
}

/**
 * Ends the session and drops every key when the auto-lock timeout has
 * passed. Called on every key read and by the background's auto-lock
 * alarm, so keys go when the timeout passes even if nothing reads them.
 * Returns whether it locked.
 */
export function enforceAutoLock(): Promise<boolean> {
  return withSessionLock(async () => {
    const session = await storagePort.get<unknown>(SESSION_KEY);
    if (!isValidSession(session) || !isSessionExpired(session.lastActivityAt, session.autoLockTimeout)) return false;
    if (await isHardwareOnlyVault()) return false;
    try {
      await clearKeyCache();
    } finally {
      await storagePort.remove(SESSION_KEY);
    }
    return true;
  });
}

/**
 * Drops keys the keyring holds with no session to use them, such as after
 * the worker stopped between importing keys and writing the session.
 * Called once per worker start, ahead of any queued unlock.
 */
export function reconcileKeyring(): Promise<void> {
  return withSessionLock(async () => {
    const session = await storagePort.get<unknown>(SESSION_KEY);
    if (!isValidSession(session)) await clearKeyCache();
  });
}

/**
 * An unlocked wallet's session entry, or `null` if the wallet is locked.
 * Handlers read keys without going through `getState`, so the auto-lock
 * timeout is enforced here too: an expired session wipes every key and
 * the session record before anything can sign. Throws
 * `HardwareWalletSigningError` for a hardware wallet, which never has a
 * key here.
 */
async function getUnlockedKey(walletId: string): Promise<SessionKeyEntry | null> {
  if (await isHardwareWallet(walletId)) throw new HardwareWalletSigningError();
  const session = await storagePort.get<unknown>(SESSION_KEY);
  if (!isValidSession(session)) return null;
  if (isSessionExpired(session.lastActivityAt, session.autoLockTimeout)) {
    await enforceAutoLock();
    return null;
  }
  if (!session.unlockedWalletIds.includes(walletId)) return null;
  return readStoredKey(walletId);
}

/**
 * A signer for an unlocked wallet, or `null` if it is locked. Same
 * auto-lock and hardware-wallet rules as every key read here.
 *
 * Each signature is a request to the keyring, so once the wallet locks,
 * a signer obtained earlier fails with `KeyringLockedError`.
 */
export async function getSigner(walletId: string): Promise<Signer | null> {
  const entry = await getUnlockedKey(walletId);
  return entry ? signerFromKeyStore(sessionKeyStore, walletId, entry) : null;
}

export async function hasCachedKey(walletId: string): Promise<boolean> {
  return (await getUnlockedKey(walletId)) !== null;
}

/**
 * Drops one wallet's key, e.g. `deleteWallet` removing a wallet that was
 * unlocked. Zeroizes the session entry's strings before removing it
 * (SIGNING-KEY-ZEROIZATION-RULE-1) and removes it from the keyring.
 */
export async function removeCachedKey(walletId: string): Promise<void> {
  try {
    await zeroizeAndRemoveEntry(walletId);
    await untrackWalletId(walletId);
  } finally {
    await sessionKeyStore.remove(walletId);
  }
}

/**
 * Wipes every key: each tracked wallet's session entry, zeroized first as
 * in `removeCachedKey`, and the whole keyring, which closes its document.
 * The keyring is cleared even when an entry can't be removed; the first
 * such error is rethrown afterwards. Leaves the rest of session storage.
 */
export async function clearKeyCache(): Promise<void> {
  try {
    const ids = (await storagePort.get<string[]>(CACHED_WALLET_IDS_KEY)) ?? [];
    const results = await Promise.allSettled(ids.map((id) => zeroizeAndRemoveEntry(id)));
    await storagePort.remove(CACHED_WALLET_IDS_KEY);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  } finally {
    await sessionKeyStore.clear();
  }
}

/**
 * Whether a usable key exists for this wallet, regardless of session state.
 * `wallet-lifecycle.ts` uses it to report a wallet as locked when its key
 * is missing, so the UI never shows "unlocked" for a wallet that can't sign.
 */
export async function isKeyStored(walletId: string): Promise<boolean> {
  return (await readStoredKey(walletId)) !== null;
}

/**
 * Auto-lock is judged against the persisted `Session.lastActivityAt`
 * rather than an in-memory timer, which an MV3 service worker restart
 * would drop. It is checked on every access and by a one-minute
 * `chrome.alarms` tick (`enforceAutoLock`), so it holds to within about a
 * minute. `"immediate"` locks one minute after the last activity rather
 * than at 0ms — a literal 0ms timeout would lock the wallet the moment
 * it's unlocked, before anything can ever sign with it.
 */
export function isSessionExpired(lastActivityAt: number, autoLockTimeout: AutoLockTimeout): boolean {
  const timeoutMs = AUTO_LOCK_TIMEOUT_MS[autoLockTimeout];
  if (timeoutMs === null) return false;
  return Date.now() - lastActivityAt > timeoutMs;
}
