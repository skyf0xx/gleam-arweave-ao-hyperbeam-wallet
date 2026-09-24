import {
  decryptFromEnvelope,
  deriveAddress,
  encryptToEnvelope,
  generateJWK,
  validateJWKShape,
  validatePassword,
  zeroize,
  type AutoLockTimeout,
  type JWKInterface,
  type LockSettings,
  type Session,
  type StoragePort,
  type ThemeSettings,
  type Wallet,
  type WalletState,
  type WalletSummary,
} from "@gleam/core";
import {
  cacheKey,
  clearKeyCache,
  isSessionExpired,
  isKeyStored,
  isValidSession,
  removeCachedKey,
  SESSION_KEY,
} from "./key-session";

/**
 * Background-side implementation of `ProtocolMap`'s wallet-lifecycle
 * methods (`packages/messaging/src/protocol.ts`) — the actual business
 * logic the messaging dispatcher (a later layer's job; ARCHITECTURE.md
 * §4.2) will route `createWallet`/`importWallet`/.../`getState` calls
 * into. Constructed with an injected `StoragePort` rather than importing
 * the concrete adapter, per the hexagonal boundary: this file is allowed
 * to know about `StoragePort`'s shape, never about `wxt/utils/storage`.
 *
 * Storage schema (all keys are this handler's own concern — `StoragePort`
 * is shape-agnostic on area per its doc comment):
 * - `local:wallets`      — `Wallet[]`, encrypted-only (never plaintext
 *   key material).
 * - `local:activeWalletId` — `string | null`.
 * - `local:lockSettings` — `LockSettings`, default `{ autoLockTimeout:
 *   "never" }`.
 * - `local:themeSettings` — `ThemeSettings`, default `{ theme: "light" }`
 *   (theme-preference's RELEVANT RULES: no OS-driven default, light
 *   always wins when nothing is stored).
 * - `session:unlockedSession` — `Session`, routed to `chrome.storage.session`
 *   (memory-only, cleared on browser close) by the storage adapter's own
 *   `local:`/`session:` area routing — this handler only ever reads/writes
 *   the `session:` prefix for it, never `local:`.
 *
 * Session-state decision (supersedes this file's original one): a derived
 * `CryptoKey`/JWK is not structured-cloneable into `chrome.storage.session`
 * in a usable form (ARCHITECTURE.md §5.1/§7.2), so `Session` itself still
 * records only bookkeeping (`unlockedAt`, `lastActivityAt`,
 * `autoLockTimeout`, `unlockedWalletIds`) — never a password or key. But
 * requiring every later signing call to carry a freshly-typed password
 * made "unlocked" a fiction (every action re-prompted), which is not how
 * a wallet extension is supposed to behave once the user has entered
 * their password — see `key-session.ts`: `unlockWallet`, `createWallet`,
 * and `importWallet` all cache the wallet's JWK in that
 * background-worker-local, in-memory map (the latter two already have the
 * plaintext JWK in hand before encrypting it, so no extra decrypt is
 * needed), so `TransferHandler`/`UploadHandler`/`ApprovalHandler` can sign
 * without asking for the password again. `lockWallet` and an expired
 * auto-lock timeout both clear that cache. Expiry is checked by
 * `loadSession` here and by `getCachedKey` on every key read, since
 * signing handlers never go through `getState`.
 */

const WALLETS_KEY = "local:wallets";
const ACTIVE_WALLET_ID_KEY = "local:activeWalletId";
const LOCK_SETTINGS_KEY = "local:lockSettings";
const THEME_SETTINGS_KEY = "local:themeSettings";

const DEFAULT_LOCK_SETTINGS: LockSettings = { autoLockTimeout: "never" };
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
  };
}

/**
 * Storage is untrusted input (onboarding-unlock's RELEVANT RULES): every
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
    (candidate.method === "jwk" || candidate.method === "ethereum" || candidate.method === "ledger") &&
    typeof candidate.publicKey === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    (candidate.encryptedKeyfile === null ||
      (typeof candidate.encryptedKeyfile === "object" && candidate.encryptedKeyfile !== null))
  );
}

async function loadWallets(storage: StoragePort): Promise<Wallet[]> {
  const raw = await storage.get<unknown>(WALLETS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidWallet);
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

/**
 * Reads back the unlocked session, treating one whose auto-lock timeout
 * has elapsed as no different from an explicit `lockWallet()` — same
 * "stays unlocked until you lock it or this timeout is reached" contract
 * `LockSettingsView` already advertises. Clears the in-memory key cache
 * on the same path so an expired session can never be used to sign even
 * if some caller reached a handler method without going through
 * `getState` first.
 */
async function loadSession(
  storage: StoragePort,
  wallets: Wallet[],
): Promise<Session | null> {
  const raw = await storage.get<unknown>(SESSION_KEY);
  if (!isValidSession(raw)) return null;
  if (isSessionExpired(raw.lastActivityAt, raw.autoLockTimeout)) {
    await clearKeyCache();
    await saveSession(storage, null);
    return null;
  }
  // Filter unlockedWalletIds against the current wallet set, same
  // untrusted-input treatment as activeWalletId.
  const knownIds = raw.unlockedWalletIds.filter((id) =>
    wallets.some((wallet) => wallet.id === id),
  );
  // A wallet whose key is gone can't sign, so it is locked whatever the
  // session record says. Persist the pruned list so getCachedKey and the
  // UI agree.
  const keyPresent = await Promise.all(knownIds.map((id) => isKeyStored(id)));
  const validIds = knownIds.filter((_, index) => keyPresent[index]);
  if (validIds.length < knownIds.length) {
    if (validIds.length === 0) {
      await clearKeyCache();
      await saveSession(storage, null);
      return null;
    }
    await saveSession(storage, { ...raw, unlockedWalletIds: validIds });
  }
  if (validIds.length === 0) return null;
  return { ...raw, unlockedWalletIds: validIds };
}

async function saveSession(storage: StoragePort, session: Session | null): Promise<void> {
  if (session === null) {
    await storage.remove(SESSION_KEY);
    return;
  }
  await storage.set(SESSION_KEY, session);
}

function jwkToBytes(jwk: JWKInterface): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(jwk)) as Uint8Array<ArrayBuffer>;
}

/**
 * Extends (or starts) the unlocked session to include a just-created/
 * imported wallet. The onboarding mockups (1.3's "Continue to wallet")
 * assume the new wallet is immediately usable without a second unlock
 * prompt — the password was just typed to set it, re-asking for it a
 * screen later would contradict TODO.md 1.2/1.3's flow.
 */
async function addUnlockedWalletToSession(
  storage: StoragePort,
  walletId: string,
  wallets: Wallet[],
): Promise<void> {
  const existing = await loadSession(storage, wallets);
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

export class WalletLifecycleHandler {
  constructor(private readonly storage: StoragePort) {}

  async createWallet(req: { name: string; password: string }): Promise<WalletSummary> {
    const passwordCheck = validatePassword(req.password);
    if (!passwordCheck.valid) {
      throw new Error(passwordCheck.reason);
    }

    const jwk = await generateJWK();
    const address = await deriveAddress(jwk);
    const now = Date.now();
    const id = crypto.randomUUID();

    // Encrypt before this key material ever reaches storage — the
    // plaintext JWK bytes are zeroized inside encryptToEnvelope's own
    // finally block, never persisted anywhere themselves.
    const encryptedKeyfile = await encryptToEnvelope(jwkToBytes(jwk), req.password, id, address);

    const wallet: Wallet = {
      id,
      address,
      name: req.name,
      method: "jwk",
      publicKey: jwk.n,
      createdAt: now,
      updatedAt: now,
      encryptedKeyfile,
    };

    const wallets = await loadWallets(this.storage);
    wallets.push(wallet);
    await saveWallets(this.storage, wallets);
    await this.storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
    // Cache the key first: loadSession treats a listed wallet with no key
    // as locked.
    await cacheKey(wallet.id, jwk, address);
    await addUnlockedWalletToSession(this.storage, wallet.id, wallets);

    return toSummary(wallet);
  }

  async importWallet(req: {
    jwk: unknown;
    name: string;
    password: string;
  }): Promise<WalletSummary> {
    const passwordCheck = validatePassword(req.password);
    if (!passwordCheck.valid) {
      throw new Error(passwordCheck.reason);
    }

    const shapeCheck = validateJWKShape(req.jwk);
    if (!shapeCheck.valid) {
      throw new Error(shapeCheck.reason);
    }

    const address = await deriveAddress(shapeCheck.jwk);
    const now = Date.now();
    const id = crypto.randomUUID();

    const encryptedKeyfile = await encryptToEnvelope(
      jwkToBytes(shapeCheck.jwk),
      req.password,
      id,
      address,
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
    };

    const wallets = await loadWallets(this.storage);
    wallets.push(wallet);
    await saveWallets(this.storage, wallets);
    await this.storage.set(ACTIVE_WALLET_ID_KEY, wallet.id);
    // Cache the key first: loadSession treats a listed wallet with no key
    // as locked.
    await cacheKey(wallet.id, shapeCheck.jwk, address);
    await addUnlockedWalletToSession(this.storage, wallet.id, wallets);

    return toSummary(wallet);
  }

  async deleteWallet(req: { walletId: string }): Promise<void> {
    const wallets = await loadWallets(this.storage);
    const remaining = wallets.filter((wallet) => wallet.id !== req.walletId);
    await saveWallets(this.storage, remaining);
    await removeCachedKey(req.walletId);

    const activeWalletId = await loadActiveWalletId(this.storage, remaining);
    if (activeWalletId === null) {
      await this.storage.set(ACTIVE_WALLET_ID_KEY, remaining[0]?.id ?? null);
    }

    const session = await loadSession(this.storage, remaining);
    if (session !== null && session.unlockedWalletIds.includes(req.walletId)) {
      const unlockedWalletIds = session.unlockedWalletIds.filter((id) => id !== req.walletId);
      await saveSession(
        this.storage,
        unlockedWalletIds.length > 0 ? { ...session, unlockedWalletIds } : null,
      );
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

  async switchWallet(req: { walletId: string }): Promise<void> {
    const wallets = await loadWallets(this.storage);
    if (!wallets.some((wallet) => wallet.id === req.walletId)) {
      throw new Error(`No stored wallet with id "${req.walletId}".`);
    }
    await this.storage.set(ACTIVE_WALLET_ID_KEY, req.walletId);
  }

  async exportWallet(req: { walletId: string; password: string }): Promise<JWKInterface> {
    const wallets = await loadWallets(this.storage);
    const wallet = wallets.find((w) => w.id === req.walletId);
    if (!wallet || !wallet.encryptedKeyfile) {
      throw new Error(`No exportable key material for wallet "${req.walletId}".`);
    }
    const plaintext = await decryptFromEnvelope(
      wallet.encryptedKeyfile,
      req.password,
      wallet.id,
      wallet.address,
    );
    try {
      return JSON.parse(new TextDecoder().decode(plaintext)) as JWKInterface;
    } finally {
      zeroize(plaintext);
    }
  }

  /** Immediately clears unlocked-session state and every cached signing key, regardless of any auto-lock timeout. */
  async lockWallet(): Promise<void> {
    await clearKeyCache();
    await saveSession(this.storage, null);
  }

  /**
   * The "forgot password" destructive reset (TODO.md 1.5b): wipes every
   * locally stored wallet, the active-wallet pointer, and the unlocked
   * session. `ProtocolMap.resetAllWallets` now pins the wire shape for
   * this method; registering it against the background dispatcher is
   * `provider-bridge`'s layer (out of this layer's scope).
   */
  async resetAllWallets(): Promise<void> {
    await clearKeyCache();
    await saveWallets(this.storage, []);
    await this.storage.remove(ACTIVE_WALLET_ID_KEY);
    await saveSession(this.storage, null);
  }

  /**
   * Tries the last-active wallet's password first, then opportunistically
   * the same password against every other stored wallet — each mismatch
   * fails silently (never surfaced as a per-wallet prompt), per the
   * onboarding-unlock RELEVANT RULES. Every wallet that unlocks
   * successfully has its decrypted JWK cached in-memory (`key-session.ts`)
   * so later signing calls (transfer/upload/approval) don't need the
   * password again for the rest of this unlocked session.
   */
  async unlockWallet(req: { password: string }): Promise<{ unlockedWalletIds: string[] }> {
    const wallets = await loadWallets(this.storage);
    const activeWalletId = await loadActiveWalletId(this.storage, wallets);
    const ordered = [
      ...wallets.filter((wallet) => wallet.id === activeWalletId),
      ...wallets.filter((wallet) => wallet.id !== activeWalletId),
    ];

    const unlockedWalletIds: string[] = [];
    for (const wallet of ordered) {
      if (!wallet.encryptedKeyfile) continue;
      try {
        const plaintext = await decryptFromEnvelope(
          wallet.encryptedKeyfile,
          req.password,
          wallet.id,
          wallet.address,
        );
        try {
          const jwk = JSON.parse(new TextDecoder().decode(plaintext)) as JWKInterface;
          await cacheKey(wallet.id, jwk, wallet.address);
        } finally {
          zeroize(plaintext);
        }
        unlockedWalletIds.push(wallet.id);
      } catch {
        // Wrong password for this wallet — silent per-wallet fallback,
        // never surfaced as a separate prompt.
      }
    }

    if (unlockedWalletIds.length === 0) {
      throw new Error(
        "That password didn't work. Try again, or use your recovery method.",
      );
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

    return { unlockedWalletIds };
  }

  /**
   * `getState` is called on every popup/sidepanel mount (`App.tsx`), which
   * makes it the natural place to refresh `lastActivityAt` — "opened the
   * extension and looked at it" counts as activity for auto-lock purposes,
   * the same way Rabby's timeout resets on interaction rather than only on
   * unlock. Refreshed only for a session `loadSession` didn't just expire.
   */
  async getState(): Promise<WalletState> {
    const wallets = await loadWallets(this.storage);
    const activeWalletId = await loadActiveWalletId(this.storage, wallets);
    const session = await loadSession(this.storage, wallets);

    if (session !== null) {
      await saveSession(this.storage, { ...session, lastActivityAt: Date.now() });
    }

    return {
      wallets: wallets.map(toSummary),
      activeWalletId,
      session,
    };
  }

  /**
   * `ProtocolMap.getLockSettings`'s backing read — the same
   * `loadLockSettings` module function `setLockSettings`/`unlockWallet`
   * already use internally, exposed as a public method so the
   * dispatcher (`entrypoints/background/index.ts`, outside this task's
   * ALLOWED SCOPE — see this task's final report) has something to wire
   * `getLockSettings` to.
   */
  async getLockSettings(): Promise<LockSettings> {
    return loadLockSettings(this.storage);
  }

  /**
   * Not part of this layer's named scope (`ProtocolMap`'s "settings"
   * group, not "wallet lifecycle") — included here only because
   * `lockWallet`'s "Lock now" screen (TODO.md 1.6) sits directly beside
   * the auto-lock timeout picker and both write the same `Session`
   * record. Exposed so a later layer's dispatcher can wire it without
   * this handler needing to change shape; not itself required by this
   * task's ALLOWED SCOPE or VERIFICATION.
   */
  async setLockSettings(req: LockSettings): Promise<void> {
    if (!VALID_AUTO_LOCK_TIMEOUTS.includes(req.autoLockTimeout)) {
      throw new Error(`Invalid auto-lock timeout "${req.autoLockTimeout}".`);
    }
    await this.storage.set(LOCK_SETTINGS_KEY, req);

    const wallets = await loadWallets(this.storage);
    const session = await loadSession(this.storage, wallets);
    if (session !== null) {
      await saveSession(this.storage, { ...session, autoLockTimeout: req.autoLockTimeout });
    }
  }

  /**
   * `ProtocolMap.getThemePreference`'s backing read — mirrors
   * `getLockSettings`, exposed as a public method so the dispatcher
   * (`entrypoints/background/index.ts`, outside this task's ALLOWED
   * SCOPE — see this task's final report) has something to wire
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
}
