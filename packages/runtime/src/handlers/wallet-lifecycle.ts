import {
  addressFromOwner,
  base64UrlToBytes,
  deriveAddress,
  capabilitiesFor,
  defaultDisplaySettings,
  isDisplayCurrency,
  isHardwareWalletMethod,
  isHeadlineBalance,
  isKeylessWalletMethod,
  isValidArweaveAddress,
  keyfileFilename,
  validateJWKShape,
  validatePassword,
  type Argon2idParams,
  type AutoLockTimeout,
  type DisplaySettings,
  type DownloadPort,
  type FileDownloadResult,
  type HardwareDevice,
  type HardwareWalletMethod,
  type JWKInterface,
  type LockSettings,
  type Session,
  type StoragePort,
  type ThemeSettings,
  type VaultEnvelope,
  type Wallet,
  type WalletState,
  type WalletSummary,
} from "@gleam/core";
import { BROWSER_RECENT_SITES_KEY, BROWSER_SAVED_SITES_KEY } from "./browser-sites";
import {
  decryptFromEnvelope,
  DEFAULT_ARGON2ID_PARAMS,
  encryptToEnvelope,
  envelopeNeedsUpgrade,
  newVaultSalt,
  VaultKdfError,
  VaultKeys,
  zeroize,
  type EncryptOptions,
  generateJWK,
} from "@gleam/core/signer";
import { isSessionExpired, isValidSession, SESSION_KEY, WALLETS_KEY, type KeySession } from "./key-session";

/**
 * Background-side implementation of `ProtocolMap`'s wallet-lifecycle
 * methods (`packages/messaging/src/protocol.ts`) — the actual business
 * logic the messaging dispatcher routes `createWallet`/`importWallet`/
 * .../`getState` calls into. Constructed with an injected `StoragePort`
 * rather than importing the concrete adapter, per the hexagonal boundary:
 * this file is allowed to know about `StoragePort`'s shape, never about
 * `wxt/utils/storage`.
 *
 * Storage schema (all keys are this handler's own concern — `StoragePort`
 * is shape-agnostic on area per its doc comment):
 * - `local:wallets`      — `Wallet[]`, encrypted-only (never plaintext
 *   key material).
 * - `local:activeWalletId` — `string | null`.
 * - `local:lockSettings` — `LockSettings`, default `{ autoLockTimeout:
 *   "1hr" }`.
 * - `local:themeSettings` — `ThemeSettings`, default `{ theme: "light" }`
 *   (no OS-driven default, light always wins when nothing is stored).
 * - `local:displaySettings` — `DisplaySettings`; with nothing stored, the
 *   currency follows the browser locale's region.
 * - `session:unlockedSession` — `Session`, routed to `chrome.storage.session`
 *   (memory-only, cleared on browser close) by the storage adapter's own
 *   `local:`/`session:` area routing — this handler only ever reads/writes
 *   the `session:` prefix for it, never `local:`.
 *
 * `Session` itself records only bookkeeping (`unlockedAt`,
 * `lastActivityAt`, `autoLockTimeout`, `unlockedWalletIds`) — never a
 * password or key. But requiring every later signing call to carry a
 * freshly-typed password made "unlocked" a fiction (every action
 * re-prompted), which is not how a wallet extension is supposed to behave
 * once the user has entered their password — see `key-session.ts`:
 * `unlockWallet`, `createWallet`, and `importWallet` all import the
 * wallet's JWK as non-extractable session keys there (the latter two
 * already have the plaintext JWK in hand before encrypting it, so no extra
 * decrypt is needed), so `TransferHandler`/`ApprovalHandler` can sign
 * without asking for the password again. `lockWallet` and an expired
 * auto-lock timeout both clear that cache. Expiry is checked by
 * `loadSession` here, by `getSigner` on every key read, since signing
 * handlers never go through `getState`, and by the background's auto-lock
 * alarm. Every method that reads or changes the session runs under
 * `withSessionLock`, so a lock and an unlock never interleave.
 */

const ACTIVE_WALLET_ID_KEY = "local:activeWalletId";
const LOCK_SETTINGS_KEY = "local:lockSettings";
const THEME_SETTINGS_KEY = "local:themeSettings";
const DISPLAY_SETTINGS_KEY = "local:displaySettings";
// Written by ReadsHandler and TransferHandler, keyed by address.
const ACTIVITY_LOG_KEY_PREFIX = "local:activityLog:";
const WATCHED_PROCESS_IDS_KEY_PREFIX = "local:watchedProcessIds:";

const DEFAULT_LOCK_SETTINGS: LockSettings = { autoLockTimeout: "1hr" };
const DEFAULT_THEME_SETTINGS: ThemeSettings = { theme: "light" };

const VALID_THEME_PREFERENCES: readonly ThemeSettings["theme"][] = ["light", "dark"];

const VALID_AUTO_LOCK_TIMEOUTS: readonly AutoLockTimeout[] = [
  "never",
  "immediate",
  "5min",
  "1hr",
  "4hr",
];

function toSummary(wallet: Wallet): WalletSummary {
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

/** An RSA-4096 modulus, the only key size Arweave addresses are made from. */
const RSA_MODULUS_BYTES = 512;
const KEYSTONE_XFP_PATTERN = /^[0-9a-fA-F]{8}$/;
const HARDWARE_METHOD_NAME: Record<HardwareWalletMethod, string> = {
  keystone: "Keystone",
  ledger: "Ledger",
};

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isValidDevice(value: unknown): value is HardwareDevice {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "keystone") {
    return typeof candidate.xfp === "string" && KEYSTONE_XFP_PATTERN.test(candidate.xfp);
  }
  if (candidate.kind === "ledger") {
    return (
      isOptionalString(candidate.model) &&
      isOptionalString(candidate.appVersion) &&
      (candidate.app === undefined || candidate.app === "Arweave" || candidate.app === "Permaweb")
    );
  }
  return false;
}

/** Hardware and watch wallets need no decrypted key, so they are usable whenever Gleam is unlocked. */
function keylessWalletIds(wallets: Wallet[]): string[] {
  return wallets.filter((wallet) => isKeylessWalletMethod(wallet.method)).map((wallet) => wallet.id);
}

/** A vault has a password exactly when some wallet holds a keyfile encrypted under it. */
function hasVaultPassword(wallets: Wallet[]): boolean {
  return wallets.some((wallet) => wallet.encryptedKeyfile !== null);
}

/**
 * Storage is untrusted input: every
 * record read back is re-validated here, on every load, dropping anything
 * malformed rather than trusting the shape a previous schema version (or
 * corruption) may have left behind.
 */
function isValidWallet(value: unknown): value is Wallet {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.address === "string" &&
    candidate.address.length > 0 &&
    typeof candidate.name === "string" &&
    (candidate.method === "jwk" ||
      candidate.method === "ethereum" ||
      candidate.method === "ledger" ||
      candidate.method === "keystone" ||
      candidate.method === "watch") &&
    typeof candidate.publicKey === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    (candidate.encryptedKeyfile === null ||
      (typeof candidate.encryptedKeyfile === "object" && candidate.encryptedKeyfile !== null)) &&
    // Older stored records predate this field — treated as "never
    // confirmed" (normalized below), not as a reason to drop the wallet.
    (candidate.backupConfirmedAt === undefined ||
      candidate.backupConfirmedAt === null ||
      typeof candidate.backupConfirmedAt === "number") &&
    (isHardwareWalletMethod(candidate.method as Wallet["method"])
      ? candidate.encryptedKeyfile === null &&
        isValidDevice(candidate.device) &&
        candidate.device.kind === candidate.method
      : candidate.device === undefined) &&
    (candidate.method !== "watch" || candidate.encryptedKeyfile === null)
  );
}

async function loadWallets(storage: StoragePort): Promise<Wallet[]> {
  const raw = await storage.get<unknown>(WALLETS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidWallet).map((wallet) => ({
    ...wallet,
    backupConfirmedAt: wallet.backupConfirmedAt ?? null,
  }));
}

async function saveWallets(storage: StoragePort, wallets: Wallet[]): Promise<void> {
  await storage.set(WALLETS_KEY, wallets);
}

async function loadActiveWalletId(
  storage: StoragePort,
  wallets: Wallet[],
): Promise<string | null> {
  const raw = await storage.get<unknown>(ACTIVE_WALLET_ID_KEY);
  if (typeof raw !== "string") return null;
  // Range-check against the currently valid wallet set — a stale id
  // pointing at a deleted/malformed wallet is dropped, not trusted.
  return wallets.some((wallet) => wallet.id === raw) ? raw : null;
}

async function loadLockSettings(storage: StoragePort): Promise<LockSettings> {
  const raw = await storage.get<unknown>(LOCK_SETTINGS_KEY);
  if (
    raw !== null &&
    typeof raw === "object" &&
    VALID_AUTO_LOCK_TIMEOUTS.includes((raw as Record<string, unknown>).autoLockTimeout as AutoLockTimeout)
  ) {
    return { autoLockTimeout: (raw as LockSettings).autoLockTimeout };
  }
  return DEFAULT_LOCK_SETTINGS;
}

async function loadThemeSettings(storage: StoragePort): Promise<ThemeSettings> {
  const raw = await storage.get<unknown>(THEME_SETTINGS_KEY);
  if (
    raw !== null &&
    typeof raw === "object" &&
    VALID_THEME_PREFERENCES.includes((raw as Record<string, unknown>).theme as ThemeSettings["theme"])
  ) {
    return { theme: (raw as ThemeSettings).theme };
  }
  return DEFAULT_THEME_SETTINGS;
}

function isDisplaySettings(value: unknown): value is DisplaySettings {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isDisplayCurrency(record.currency) &&
    typeof record.compactHeader === "boolean" &&
    typeof record.showTokenLogos === "boolean" &&
    isHeadlineBalance(record.headline) &&
    typeof record.balancesHidden === "boolean"
  );
}

async function loadDisplaySettings(storage: StoragePort): Promise<DisplaySettings> {
  const raw = await storage.get<unknown>(DISPLAY_SETTINGS_KEY);
  // Older records lack `showTokenLogos`, or carry `showChart` in place of `compactHeader`. Someone who
  // had turned the chart off gets the compact header, the closest thing to it; the rest is kept.
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const upgraded = record
    ? { showTokenLogos: false, compactHeader: record.showChart === false, ...record }
    : raw;
  if (isDisplaySettings(upgraded)) {
    return {
      currency: upgraded.currency,
      compactHeader: upgraded.compactHeader,
      showTokenLogos: upgraded.showTokenLogos,
      headline: upgraded.headline,
      balancesHidden: upgraded.balancesHidden,
    };
  }
  return defaultDisplaySettings(globalThis.navigator?.language);
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
async function loadSession(
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
async function lockSession(storage: StoragePort, keySession: KeySession): Promise<void> {
  try {
    await keySession.clearKeyCache();
  } finally {
    await saveSession(storage, null);
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

async function saveSession(storage: StoragePort, session: Session | null): Promise<void> {
  if (session === null) {
    await storage.remove(SESSION_KEY);
    return;
  }
  await storage.set(SESSION_KEY, session);
}

function sameEnvelope(a: VaultEnvelope, b: VaultEnvelope): boolean {
  return a.version === b.version && a.salt === b.salt && a.iv === b.iv && a.ciphertext === b.ciphertext;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

interface EnvelopeUpgrade {
  walletId: string;
  from: VaultEnvelope;
  to: VaultEnvelope;
}

function jwkToBytes(jwk: JWKInterface): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(jwk)) as Uint8Array<ArrayBuffer>;
}

/**
 * Extends (or starts) the unlocked session to include a just-created/
 * imported wallet: the new wallet is immediately usable without a second
 * unlock prompt, since the password was just typed to set it.
 *
 * The session is loaded before the key is cached. loadSession may clear
 * the key cache (an expired session, or a session that listed only
 * hardware wallets before this keyfile gave the vault a password), and
 * that must not take the new key with it.
 */
async function unlockNewWallet(
  storage: StoragePort,
  keySession: KeySession,
  wallets: Wallet[],
  walletId: string,
  jwk: JWKInterface,
  address: string,
): Promise<void> {
  const existing = await loadSession(storage, keySession, wallets);
  await keySession.cacheKey(walletId, jwk, address);
  const lockSettings = await loadLockSettings(storage);
  const now = Date.now();

  if (existing === null) {
    await saveSession(storage, {
      unlockedAt: now,
      lastActivityAt: now,
      autoLockTimeout: lockSettings.autoLockTimeout,
      unlockedWalletIds: [walletId],
    });
    return;
  }

  if (!existing.unlockedWalletIds.includes(walletId)) {
    await saveSession(storage, {
      ...existing,
      lastActivityAt: now,
      unlockedWalletIds: [...existing.unlockedWalletIds, walletId],
    });
  }
}

export interface WalletLifecycleOptions {
  /** Argon2id cost for new and re-encrypted envelopes. */
  kdfParams?: Argon2idParams;
  /** Where `downloadKeyfile` saves the keyfile. */
  downloads?: DownloadPort;
}

export class WalletLifecycleHandler {
  private readonly kdfParams: Argon2idParams;
  private readonly downloads: DownloadPort | undefined;
  private pendingUpgrade: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StoragePort,
    private readonly keySession: KeySession,
    options: WalletLifecycleOptions = {},
  ) {
    this.kdfParams = options.kdfParams ?? DEFAULT_ARGON2ID_PARAMS;
    this.downloads = options.downloads;
  }

  /**
   * Encryption settings for a new envelope in a vault where `opened` is an
   * envelope the password already decrypted. Reusing a current envelope's
   * salt and params lets `keys` serve the new envelope without a second
   * Argon2id run, and keeps unlock at one derivation for the whole vault.
   */
  private encryptOptionsFor(opened: VaultEnvelope | null): EncryptOptions {
    if (opened?.version === 2 && !envelopeNeedsUpgrade(opened, this.kdfParams)) {
      const { memoryKiB, iterations, parallelism, salt } = opened;
      return { params: { memoryKiB, iterations, parallelism }, salt };
    }
    return { params: this.kdfParams };
  }

  /**
   * Every wallet shares the one vault password. The first wallet sets it,
   * so it must pass the password policy. Later wallets must reuse it: the
   * password has to open an existing envelope, or the vault would end up
   * with wallets that unlock under different passwords. The policy check
   * is skipped then, because a password that opens the vault is the vault
   * password even if it predates the current policy.
   */
  private async checkNewWalletPassword(keys: VaultKeys, password: string): Promise<EncryptOptions> {
    const wallets = await loadWallets(this.storage);
    if (!hasVaultPassword(wallets)) {
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.valid) {
        throw new Error(passwordCheck.reason);
      }
      return this.encryptOptionsFor(null);
    }
    const opened = await this.opensVault(wallets, keys);
    if (!opened) {
      throw new Error("That password didn't work. Use the password you unlock Gleam with.");
    }
    return this.encryptOptionsFor(opened);
  }

  /**
   * The first stored envelope `keys` decrypts, or null if the password
   * opens none. Throws `VaultKdfError` instead of returning null when an
   * envelope couldn't be checked at all, so that never reads as a wrong
   * password.
   */
  private async opensVault(wallets: Wallet[], keys: VaultKeys): Promise<VaultEnvelope | null> {
    const activeWalletId = await loadActiveWalletId(this.storage, wallets);
    const encrypted = [
      ...wallets.filter((wallet) => wallet.id === activeWalletId),
      ...wallets.filter((wallet) => wallet.id !== activeWalletId),
    ].flatMap((wallet) => (wallet.encryptedKeyfile ? [{ wallet, envelope: wallet.encryptedKeyfile }] : []));

    let kdfError: VaultKdfError | null = null;
    for (const { wallet, envelope } of encrypted) {
      try {
        const plaintext = await decryptFromEnvelope(envelope, keys, wallet.id, wallet.address);
        zeroize(plaintext);
        return envelope;
      } catch (error) {
        if (!(error instanceof VaultKdfError)) continue;
        // Wrong password or unreadable for this wallet; a vault from before
        // the shared password may have others that it opens.
        kdfError ??= error;
      }
    }
    if (kdfError) throw kdfError;
    return null;
  }

  /** Throws unless the vault has a password and `password` is it. */
  async checkVaultPassword(req: { password: string }): Promise<void> {
    const wallets = await loadWallets(this.storage);
    if (!hasVaultPassword(wallets)) {
      throw new Error("Gleam has no password to protect. Add a wallet with a keyfile first.");
    }
    if (!(await this.opensVault(wallets, new VaultKeys(req.password)))) {
      throw new Error("That password didn't work. Use the password you unlock Gleam with.");
    }
  }

  /**
   * `opens: false` only when the password definitely opens nothing,
   * including a vault with no password. A check that couldn't run
   * rejects instead, so a caller never mistakes it for a wrong password.
   */
  async probeVaultPassword(req: { password: string }): Promise<{ opens: boolean }> {
    const wallets = await loadWallets(this.storage);
    if (!hasVaultPassword(wallets)) return { opens: false };
    return { opens: (await this.opensVault(wallets, new VaultKeys(req.password))) !== null };
  }

  async hasVaultPassword(): Promise<boolean> {
    return hasVaultPassword(await loadWallets(this.storage));
  }

  async createWallet(req: { name: string; password: string }): Promise<WalletSummary> {
    return this.keySession.withSessionLock(async () => {
      const keys = new VaultKeys(req.password);
      const encryptOptions = await this.checkNewWalletPassword(keys, req.password);

      const jwk = await generateJWK();
      const address = await deriveAddress(jwk);
      const now = Date.now();
      const id = crypto.randomUUID();

      // Encrypt before this key material ever reaches storage — the
      // plaintext JWK bytes are zeroized inside encryptToEnvelope's own
      // finally block, never persisted anywhere themselves.
      const encryptedKeyfile = await encryptToEnvelope(jwkToBytes(jwk), keys, id, address, encryptOptions);

      const wallet: Wallet = {
        id,
        address,
        name: req.name,
        method: "jwk",
        publicKey: jwk.n,
        createdAt: now,
        updatedAt: now,
        encryptedKeyfile,
        backupConfirmedAt: null,
      };

      const wallets = await loadWallets(this.storage);
      wallets.push(wallet);
      await saveWallets(this.storage, wallets);
      await this.storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
      await unlockNewWallet(this.storage, this.keySession, wallets, wallet.id, jwk, address);

      return toSummary(wallet);
    });
  }

  async importWallet(req: {
    jwk: unknown;
    name: string;
    password: string;
  }): Promise<WalletSummary> {
    return this.keySession.withSessionLock(async () => {
      const keys = new VaultKeys(req.password);
      const encryptOptions = await this.checkNewWalletPassword(keys, req.password);

      const shapeCheck = validateJWKShape(req.jwk);
      if (!shapeCheck.valid) {
        throw new Error(shapeCheck.reason);
      }

      const address = await deriveAddress(shapeCheck.jwk);
      const wallets = await loadWallets(this.storage);

      // Same key, already in the vault: switch to it instead of adding a
      // second row that would share one address across two wallet ids, which
      // would fork the activity log and token list the address is keyed by.
      const existing = wallets.find((wallet) => wallet.address === address);
      if (existing && isHardwareWalletMethod(existing.method)) {
        throw new Error(`This address is already in Gleam as the hardware wallet "${existing.name}".`);
      }
      if (existing?.method === "watch") {
        throw new Error(`This address is already in Gleam as the watch-only wallet "${existing.name}". Remove it, then import the keyfile.`);
      }
      if (existing) {
        await this.storage.set(ACTIVE_WALLET_ID_KEY, existing.id);
        await unlockNewWallet(this.storage, this.keySession, wallets, existing.id, shapeCheck.jwk, address);
        return toSummary(existing);
      }

      const now = Date.now();
      const id = crypto.randomUUID();

      const encryptedKeyfile = await encryptToEnvelope(
        jwkToBytes(shapeCheck.jwk),
        keys,
        id,
        address,
        encryptOptions,
      );

      const wallet: Wallet = {
        id,
        address,
        name: req.name,
        method: "jwk",
        publicKey: shapeCheck.jwk.n,
        createdAt: now,
        updatedAt: now,
        encryptedKeyfile,
        backupConfirmedAt: null,
      };

      // Re-read: an envelope upgrade may have written while Argon2id ran.
      const current = await loadWallets(this.storage);
      current.push(wallet);
      await saveWallets(this.storage, current);
      await this.storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
      await unlockNewWallet(this.storage, this.keySession, current, wallet.id, shapeCheck.jwk, address);

      return toSummary(wallet);
    });
  }

  /**
   * Adds a wallet whose key lives on a Keystone or Ledger. Only the public
   * key and device details are stored. No password is asked for, so a
   * vault that has one must already be unlocked: otherwise this would add
   * a wallet to a locked Gleam.
   */
  async addHardwareWallet(req: {
    method: HardwareWalletMethod;
    publicKey: string;
    device: HardwareDevice;
    name?: string;
  }): Promise<WalletSummary> {
    return this.keySession.withSessionLock(async () => {
      if (!isHardwareWalletMethod(req.method)) {
        throw new Error(`"${String(req.method)}" isn't a hardware wallet type.`);
      }
      if (!isValidDevice(req.device) || req.device.kind !== req.method) {
        throw new Error("The device details don't match this wallet type.");
      }
      let modulus: Uint8Array;
      try {
        modulus = base64UrlToBytes(req.publicKey);
      } catch {
        throw new Error("The device sent a public key that isn't valid base64url.");
      }
      if (modulus.length !== RSA_MODULUS_BYTES) {
        throw new Error(
          `The device sent a ${modulus.length}-byte public key. An Arweave key is ${RSA_MODULUS_BYTES} bytes.`,
        );
      }

      const wallets = await loadWallets(this.storage);
      if (hasVaultPassword(wallets) && (await loadSession(this.storage, this.keySession, wallets)) === null) {
        throw new Error("Unlock Gleam before adding a hardware wallet.");
      }

      const address = await addressFromOwner(req.publicKey);
      const existing = wallets.find((wallet) => wallet.address === address);
      if (existing) {
        throw new Error(`This address is already in Gleam as "${existing.name}".`);
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
      await saveWallets(this.storage, wallets);
      await this.storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
      // loadSession lists every hardware wallet, so this adds the new one to
      // an unlocked session, or starts one for a vault without a password.
      await loadSession(this.storage, this.keySession, wallets);

      return toSummary(wallet);
    });
  }

  /**
   * Adds an address to follow, with no key. Like a hardware wallet it asks
   * for no password, so a vault that has one must already be unlocked.
   */
  async addWatchWallet(req: { address: string; name?: string }): Promise<WalletSummary> {
    return this.keySession.withSessionLock(async () => {
      const address = req.address.trim();
      if (!isValidArweaveAddress(address)) {
        throw new Error("That isn't an Arweave address. An address is 43 letters, numbers, - and _.");
      }

      const wallets = await loadWallets(this.storage);
      if (hasVaultPassword(wallets) && (await loadSession(this.storage, this.keySession, wallets)) === null) {
        throw new Error("Unlock Gleam before adding a wallet.");
      }
      const existing = wallets.find((wallet) => wallet.address === address);
      if (existing) {
        throw new Error(`This address is already in Gleam as "${existing.name}".`);
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
      await saveWallets(this.storage, wallets);
      await this.storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
      await loadSession(this.storage, this.keySession, wallets);

      return toSummary(wallet);
    });
  }

  async deleteWallet(req: { walletId: string }): Promise<void> {
    return this.keySession.withSessionLock(async () => {
      const wallets = await loadWallets(this.storage);
      const remaining = wallets.filter((wallet) => wallet.id !== req.walletId);
      await saveWallets(this.storage, remaining);
      try {
        await this.keySession.removeCachedKey(req.walletId);
      } finally {
        await this.finishDeleteWallet(req.walletId, remaining);
      }
    });
  }

  private async finishDeleteWallet(walletId: string, remaining: Wallet[]): Promise<void> {
    const activeWalletId = await loadActiveWalletId(this.storage, remaining);
    if (activeWalletId === null) {
      await this.storage.set(ACTIVE_WALLET_ID_KEY, remaining[0]?.id ?? null);
    }

    const session = await loadSession(this.storage, this.keySession, remaining);
    if (session !== null && session.unlockedWalletIds.includes(walletId)) {
      const unlockedWalletIds = session.unlockedWalletIds.filter((id) => id !== walletId);
      if (unlockedWalletIds.length > 0) {
        await saveSession(this.storage, { ...session, unlockedWalletIds });
      } else {
        await lockSession(this.storage, this.keySession);
      }
    }
  }

  async renameWallet(req: { walletId: string; name: string }): Promise<void> {
    const wallets = await loadWallets(this.storage);
    const index = wallets.findIndex((wallet) => wallet.id === req.walletId);
    if (index === -1) {
      throw new Error(`No stored wallet with id "${req.walletId}".`);
    }
    wallets[index] = { ...wallets[index]!, name: req.name, updatedAt: Date.now() };
    await saveWallets(this.storage, wallets);
  }

  /**
   * Records that the user confirmed they backed up this wallet's keyfile.
   * Called by `downloadKeyfile` once the keyfile is saved, never on a
   * cancelled or failed download.
   */
  async confirmWalletBackup(req: { walletId: string }): Promise<void> {
    const wallets = await loadWallets(this.storage);
    const index = wallets.findIndex((wallet) => wallet.id === req.walletId);
    if (index === -1) {
      throw new Error(`No stored wallet with id "${req.walletId}".`);
    }
    wallets[index] = { ...wallets[index]!, backupConfirmedAt: Date.now() };
    await saveWallets(this.storage, wallets);
  }

  async switchWallet(req: { walletId: string }): Promise<void> {
    const wallets = await loadWallets(this.storage);
    if (!wallets.some((wallet) => wallet.id === req.walletId)) {
      throw new Error(`No stored wallet with id "${req.walletId}".`);
    }
    await this.storage.set(ACTIVE_WALLET_ID_KEY, req.walletId);
  }

  /**
   * At most one `downloadKeyfile` per wallet: a newer call, or
   * `cancelKeyfileDownload`, ends an older one still waiting for the
   * `downloads` grant, so one grant can't release two saves.
   */
  private readonly keyfileDownloads = new Map<string, AbortController>();

  async downloadKeyfile(req: { walletId: string; password: string }): Promise<FileDownloadResult> {
    const downloads = this.downloads;
    if (!downloads) {
      throw new Error("Keyfile downloads aren't available here.");
    }
    const wallets = await loadWallets(this.storage);
    const wallet = wallets.find((w) => w.id === req.walletId);
    if (wallet?.method === "watch") {
      throw new Error("This wallet is watch-only. Gleam has no keyfile for it.");
    }
    if (wallet && !capabilitiesFor(wallet.method).exportKey) {
      throw new Error("This wallet's key stays on its device. There's no keyfile to export.");
    }
    if (!wallet || !wallet.encryptedKeyfile) {
      throw new Error(`No exportable key material for wallet "${req.walletId}".`);
    }
    const envelope = wallet.encryptedKeyfile;
    // One VaultKeys so the decrypt after a permission grant reuses the
    // derived key instead of running Argon2id again.
    const keys = new VaultKeys(req.password);
    const decrypt = () => decryptFromEnvelope(envelope, keys, wallet.id, wallet.address);

    this.keyfileDownloads.get(wallet.id)?.abort();
    const current = new AbortController();
    this.keyfileDownloads.set(wallet.id, current);
    let plaintext: Uint8Array;
    try {
      // Decrypting first means a wrong password fails at once, while the
      // popup may still be open, rather than after the permission prompt.
      plaintext = await decrypt();
      if (!(await downloads.isAllowed())) {
        // Nothing decrypted is held while waiting for the grant.
        zeroize(plaintext);
        if (!(await downloads.ensureAllowed(current.signal))) {
          return { ok: false, reason: "permission" };
        }
        plaintext = await decrypt();
      }
    } finally {
      if (this.keyfileDownloads.get(wallet.id) === current) this.keyfileDownloads.delete(wallet.id);
    }

    // The envelope holds the keyfile's JSON bytes as created or imported,
    // so they are saved as-is: a standard keyfile any Arweave wallet reads.
    let result: FileDownloadResult;
    try {
      result = await downloads.saveFile({
        filename: keyfileFilename(wallet.name),
        mimeType: "application/json",
        bytes: plaintext,
      });
    } finally {
      zeroize(plaintext);
    }
    // Recorded here, not by the UI: a save dialog or permission prompt can
    // close the popup before it hears back.
    if (result.ok) await this.confirmWalletBackup({ walletId: wallet.id });
    return result;
  }

  /** Ends a `downloadKeyfile` still waiting for the `downloads` grant, e.g. after the user denied it. */
  cancelKeyfileDownload(req: { walletId: string }): void {
    this.keyfileDownloads.get(req.walletId)?.abort();
    this.keyfileDownloads.delete(req.walletId);
  }

  /** Immediately clears unlocked-session state and every cached signing key, regardless of any auto-lock timeout. */
  async lockWallet(): Promise<void> {
    return this.keySession.withSessionLock(async () => {
      await lockSession(this.storage, this.keySession);
    });
  }

  /**
   * The "forgot password" destructive reset: wipes every stored wallet,
   * each wallet's activity log and watched tokens, the active-wallet
   * pointer, and the unlocked session. dApp grants and pending approvals
   * are `ApprovalHandler.revokeAllAccess`'s to clear; the background
   * calls both.
   */
  async resetAllWallets(): Promise<void> {
    return this.keySession.withSessionLock(async () => {
      try {
        await this.keySession.clearKeyCache();
      } finally {
        await this.wipeVault();
      }
    });
  }

  private async wipeVault(): Promise<void> {
    const wallets = await loadWallets(this.storage);
    await Promise.all(
      wallets.flatMap((wallet) => [
        this.storage.remove(`${ACTIVITY_LOG_KEY_PREFIX}${wallet.address}`),
        this.storage.remove(`${WATCHED_PROCESS_IDS_KEY_PREFIX}${wallet.address}`),
      ]),
    );
    await saveWallets(this.storage, []);
    await this.storage.remove(ACTIVE_WALLET_ID_KEY);
    await this.storage.remove(BROWSER_SAVED_SITES_KEY);
    await this.storage.remove(BROWSER_RECENT_SITES_KEY);
    await saveSession(this.storage, null);
  }

  /**
   * Tries the last-active wallet's password first, then opportunistically
   * the same password against every other stored wallet — each mismatch
   * fails silently (never surfaced as a per-wallet prompt). Every wallet that unlocks
   * successfully has its key imported as non-extractable session keys
   * (`key-session.ts`) so later signing calls (transfer/approval)
   * don't need the password again for the rest of this unlocked session.
   *
   * Envelopes below the current KDF cost (every PBKDF2 one) are then
   * re-encrypted under Argon2id, since this is the only time the password
   * is known. That runs after the session is saved and is not awaited, so
   * it never delays or fails the unlock.
   */
  async unlockWallet(req: { password: string }): Promise<{ unlockedWalletIds: string[] }> {
    return this.keySession.withSessionLock(async () => {
      const wallets = await loadWallets(this.storage);
      const activeWalletId = await loadActiveWalletId(this.storage, wallets);
      const ordered = [
        ...wallets.filter((wallet) => wallet.id === activeWalletId),
        ...wallets.filter((wallet) => wallet.id !== activeWalletId),
      ];

      const keys = new VaultKeys(req.password);
      const unlockedWalletIds: string[] = [];
      const opened: { wallet: Wallet; envelope: VaultEnvelope }[] = [];
      let kdfError: VaultKdfError | null = null;
      const importedWalletIds: string[] = [];
      try {
        for (const wallet of ordered) {
          if (!wallet.encryptedKeyfile) continue;
          let jwk: JWKInterface;
          try {
            const plaintext = await decryptFromEnvelope(
              wallet.encryptedKeyfile,
              keys,
              wallet.id,
              wallet.address,
            );
            try {
              jwk = JSON.parse(new TextDecoder().decode(plaintext)) as JWKInterface;
            } finally {
              zeroize(plaintext);
            }
          } catch (error) {
            // Wrong password for this wallet — silent per-wallet fallback,
            // never surfaced as a separate prompt. An envelope that couldn't be
            // checked at all is reported only if nothing else unlocks.
            if (error instanceof VaultKdfError) kdfError ??= error;
            continue;
          }
          // Outside the wrong-password catch: a storage failure here must
          // reach the user as itself.
          importedWalletIds.push(wallet.id);
          await this.keySession.cacheKey(wallet.id, jwk, wallet.address);
          unlockedWalletIds.push(wallet.id);
          opened.push({ wallet, envelope: wallet.encryptedKeyfile });
        }

        if (unlockedWalletIds.length === 0 && kdfError) throw kdfError;
        // A vault of only hardware and watch wallets has no password, so
        // there is nothing to check it against.
        if (unlockedWalletIds.length === 0 && hasVaultPassword(wallets)) {
          throw new Error(
            "That password didn't work. Try again, or use your recovery method.",
          );
        }
        unlockedWalletIds.push(...keylessWalletIds(ordered));
        if (unlockedWalletIds.length === 0) {
          throw new Error("There's no wallet to unlock.");
        }

        const now = Date.now();
        const lockSettings = await loadLockSettings(this.storage);
        const session: Session = {
          unlockedAt: now,
          lastActivityAt: now,
          autoLockTimeout: lockSettings.autoLockTimeout,
          unlockedWalletIds,
        };
        await saveSession(this.storage, session);

        this.pendingUpgrade = this.upgradeEnvelopes(opened, keys, req.password);
        return { unlockedWalletIds };
      } catch (error) {
        // Keys this attempt imported must not outlive it: no session will list them.
        await Promise.allSettled(importedWalletIds.map((walletId) => this.keySession.removeCachedKey(walletId)));
        throw error;
      }
    });
  }

  /** Settles once the envelope upgrade started by the last unlock has finished or given up. */
  envelopeUpgradeSettled(): Promise<void> {
    return this.pendingUpgrade;
  }

  /**
   * Re-encrypts each outdated envelope in `opened` and writes them all in
   * one `local:wallets` set, which chrome.storage applies atomically: a
   * failure anywhere leaves every old envelope in place. Each new envelope
   * is decrypted and compared before the write, with a key derived afresh
   * from the password: `keys` already holds the derived key in memory, so
   * reading back through it would not catch a derivation that comes out
   * differently next time and locks the wallet for good. It replaces the stored
   * one only if that is still the envelope that was opened, so a wallet
   * deleted or re-keyed meanwhile is left alone.
   */
  private async upgradeEnvelopes(
    opened: { wallet: Wallet; envelope: VaultEnvelope }[],
    keys: VaultKeys,
    password: string,
  ): Promise<void> {
    try {
      const outdated = opened.filter(({ envelope }) => envelopeNeedsUpgrade(envelope, this.kdfParams));
      if (outdated.length === 0) return;
      const current = opened.find(({ envelope }) => !envelopeNeedsUpgrade(envelope, this.kdfParams));
      const encryptOptions = this.encryptOptionsFor(current?.envelope ?? null);
      // Without a current envelope to share, every upgrade still shares one
      // fresh salt, so the next unlock derives a single key.
      const salt = encryptOptions.salt ?? newVaultSalt();

      const verifyKeys = new VaultKeys(password);
      const upgrades: EnvelopeUpgrade[] = [];
      for (const { wallet, envelope } of outdated) {
        const plaintext = await decryptFromEnvelope(envelope, keys, wallet.id, wallet.address);
        try {
          const upgraded = await encryptToEnvelope(
            plaintext.slice(),
            keys,
            wallet.id,
            wallet.address,
            { ...encryptOptions, salt },
          );
          const check = await decryptFromEnvelope(upgraded, verifyKeys, wallet.id, wallet.address);
          const matches = sameBytes(check, plaintext);
          zeroize(check);
          if (!matches) throw new Error("A re-encrypted keyfile didn't read back.");
          upgrades.push({ walletId: wallet.id, from: envelope, to: upgraded });
        } finally {
          zeroize(plaintext);
        }
      }

      const stored = await loadWallets(this.storage);
      let changed = false;
      const next = stored.map((wallet) => {
        const upgrade = upgrades.find((candidate) => candidate.walletId === wallet.id);
        if (!upgrade || !wallet.encryptedKeyfile || !sameEnvelope(wallet.encryptedKeyfile, upgrade.from)) {
          return wallet;
        }
        changed = true;
        return { ...wallet, encryptedKeyfile: upgrade.to };
      });
      if (changed) await saveWallets(this.storage, next);
    } catch (error) {
      console.warn("Gleam kept the existing keyfile encryption; the upgrade will retry on the next unlock.", error);
    }
  }

  /**
   * Reads the wallets and session. Only `recordActivity` refreshes
   * `lastActivityAt`, and only the extension pages' own messages pass it
   * (popup and side panel mounts, and the user's answer in an approval
   * window, which a site opens and so doesn't count by loading): a connected
   * site's reads and background housekeeping also call this, and counting
   * those would let a polling page keep the vault unlocked past auto-lock.
   * Refreshed only for a session `loadSession` didn't just expire.
   */
  async getState({ recordActivity = false }: { recordActivity?: boolean } = {}): Promise<WalletState> {
    return this.keySession.withSessionLock(async () => {
      const wallets = await loadWallets(this.storage);
      const activeWalletId = await loadActiveWalletId(this.storage, wallets);
      let session = await loadSession(this.storage, this.keySession, wallets);

      if (session !== null && recordActivity) {
        session = { ...session, lastActivityAt: Date.now() };
        await saveSession(this.storage, session);
      }

      return {
        wallets: wallets.map(toSummary),
        activeWalletId,
        session,
      };
    });
  }

  /**
   * `ProtocolMap.getLockSettings`'s backing read — the same
   * `loadLockSettings` module function `setLockSettings`/`unlockWallet`
   * already use internally, exposed as a public method so the dispatcher
   * (`create-runtime.ts`) has something to wire
   * `getLockSettings` to.
   */
  async getLockSettings(): Promise<LockSettings> {
    return loadLockSettings(this.storage);
  }

  /**
   * Run on an extension update. Vaults from before the 1-hour default ran
   * with "never" without anyone choosing it, so they keep it rather than
   * starting to lock after the update. Only new installs get the default.
   */
  async keepLockTimeoutOnUpdate(): Promise<void> {
    return this.keySession.withSessionLock(async () => {
      if ((await this.storage.get<unknown>(LOCK_SETTINGS_KEY)) !== null) return;
      if ((await loadWallets(this.storage)).length === 0) return;
      await this.storage.set(LOCK_SETTINGS_KEY, { autoLockTimeout: "never" } satisfies LockSettings);
    });
  }

  /**
   * Not part of this layer's named scope (`ProtocolMap`'s "settings"
   * group, not "wallet lifecycle") — included here only because
   * `lockWallet`'s "Lock now" screen sits directly beside the auto-lock
   * timeout picker and both write the same `Session` record.
   */
  async setLockSettings(req: LockSettings): Promise<void> {
    return this.keySession.withSessionLock(async () => {
      if (!VALID_AUTO_LOCK_TIMEOUTS.includes(req.autoLockTimeout)) {
        throw new Error(`Invalid auto-lock timeout "${req.autoLockTimeout}".`);
      }
      await this.storage.set(LOCK_SETTINGS_KEY, req);

      const wallets = await loadWallets(this.storage);
      const session = await loadSession(this.storage, this.keySession, wallets);
      if (session !== null) {
        await saveSession(this.storage, { ...session, autoLockTimeout: req.autoLockTimeout });
      }
    });
  }

  /**
   * `ProtocolMap.getThemePreference`'s backing read — mirrors
   * `getLockSettings`, exposed as a public method so the dispatcher
   * (`create-runtime.ts`) has something to wire
   * `getThemePreference` to.
   */
  async getThemePreference(): Promise<ThemeSettings> {
    return loadThemeSettings(this.storage);
  }

  /**
   * `ProtocolMap.setThemePreference`'s backing write. Wallet-owner-only
   * local UI setting (see `protocol.ts`'s doc comment on
   * `getThemePreference`) — no session or other stored record depends on
   * the theme value, unlike `setLockSettings`'s session-timeout sync.
   */
  async setThemePreference(req: ThemeSettings): Promise<void> {
    if (!VALID_THEME_PREFERENCES.includes(req.theme)) {
      throw new Error(`Invalid theme preference "${req.theme}".`);
    }
    await this.storage.set(THEME_SETTINGS_KEY, req);
  }

  async getDisplaySettings(): Promise<DisplaySettings> {
    return loadDisplaySettings(this.storage);
  }

  async setDisplaySettings(req: DisplaySettings): Promise<void> {
    if (!isDisplaySettings(req)) throw new Error("Invalid display settings.");
    await this.storage.set(DISPLAY_SETTINGS_KEY, {
      currency: req.currency,
      compactHeader: req.compactHeader,
      showTokenLogos: req.showTokenLogos,
      headline: req.headline,
      balancesHidden: req.balancesHidden,
    });
  }
}
