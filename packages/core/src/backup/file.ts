import { isValidArweaveAddress, isValidContact } from "../models/contact";
import { isDisplaySettings } from "../models/display";
import { isValidNetworkSettings } from "../models/network";
import { isPasskeyEnrollment } from "../models/passkey";
import { readSecurityPhrase } from "../models/security-phrase";
import { isLockSettings } from "../models/session";
import { isExactHttpOrigin } from "../models/site-origin";
import { isValidWallet, type VaultEnvelopeV2, type Wallet } from "../models/wallet";
import { base64ToBytes, bytesToBase64 } from "../vault/base64";
import { isPlainRecord, isRecord } from "../models/guards";

type Bytes = Uint8Array<ArrayBuffer>;

export const BACKUP_FORMAT_VERSION = 1;

/**
 * A vault is a few kilobytes per wallet. Anything near this size is not a
 * Gleam backup, and is refused before it is parsed.
 */
export const MAX_BACKUP_FILE_BYTES = 8 * 1024 * 1024;

/** Which backup a file is, and which install wrote it when. */
export interface BackupStamp {
  v: typeof BACKUP_FORMAT_VERSION;
  /** Minted at setup; the same for every device sharing the file. */
  backupId: string;
  updatedAt: number;
  /** A random id per install. */
  writer: string;
}

/**
 * A passkey that can stand in for the password on restore: the vault
 * password wrapped under the passkey's PRF output, exactly as
 * `local:passkey` holds it. Only the authenticator holding the passkey can
 * compute the key that opens it, so it sits in the clear header beside
 * the password-wrapped backup key.
 */
export interface BackupPasskey {
  credentialId: string;
  prfSalt: string;
  iv: string;
  ciphertext: string;
}

/**
 * The clear part of the file. `wrapped` is the backup key wrapped under
 * the vault password. `passkeys`, newest install first, lets a restore
 * offer a passkey before the body can be opened; a release that doesn't
 * know the field ignores it.
 */
export interface BackupHeader extends BackupStamp {
  wrapped: VaultEnvelopeV2;
  passkeys?: BackupPasskey[];
}

/** Storage values by storage key. */
export type BackupData = Record<string, unknown>;

/**
 * What an install removed that another install's copy still holds, by
 * storage key: wallet and contact addresses, token process ids and site
 * origins. A pull never adds these back (`planPull`).
 */
export type BackupRemoved = Record<string, string[]>;

/** One install's vault, as of its last write. */
export interface BackupDevice {
  updatedAt: number;
  data: BackupData;
  /** Absent in files older releases wrote. Read through `removedOf`, since nothing here checks it. */
  removed?: BackupRemoved;
}

/** Past this many installs the file is not one Gleam wrote. */
export const MAX_BACKUP_DEVICES = 16;

/**
 * The encrypted part of the file. It repeats the stamp so the header,
 * which nothing authenticates, can be checked against it after decryption.
 *
 * Each install sharing the backup keeps its own vault under its `writer`
 * id and replaces only that on a write, so no device overwrites what
 * another added, and a wallet deleted on every device that had it is gone
 * from the backup. A restore merges them all (`mergeBackupDevices`).
 */
export interface BackupBody extends BackupStamp {
  devices: Record<string, BackupDevice>;
}

export interface BackupFile {
  header: BackupHeader;
  /** The body as `sealBackup` returned it. */
  sealed: Bytes;
}

export const WALLETS_BACKUP_KEY = "local:wallets";
export const ACTIVE_WALLET_BACKUP_KEY = "local:activeWalletId";
export const CONTACTS_BACKUP_KEY = "local:contacts";
/** Followed by a wallet's address. */
export const WATCHED_TOKENS_BACKUP_PREFIX = "local:watchedProcessIds:";
export const SAVED_SITES_BACKUP_KEY = "local:browserSavedSites";

interface BackupRule {
  /** A list is checked item by item, so one bad item costs only itself when a backup is built. */
  list: boolean;
  ok(value: unknown): boolean;
}

function isTokenId(value: unknown): boolean {
  return typeof value === "string" && isValidArweaveAddress(value);
}

/**
 * Any named theme, since a theme comes and goes between releases and an
 * unknown one must not refuse the wallets beside it. Reading the setting
 * checks the name and falls back to the default.
 */
function isThemeRecord(value: unknown): boolean {
  return isRecord(value) && typeof value.theme === "string";
}

/**
 * Everything a backup carries: the vault as its owner knows it. Nothing
 * bound to a device or a site is here: no dApp grants (a new device
 * approves each site again), sessions, caches or dismissals.
 */
const RULES: Readonly<Record<string, BackupRule>> = {
  [WALLETS_BACKUP_KEY]: { list: true, ok: isValidWallet },
  [ACTIVE_WALLET_BACKUP_KEY]: { list: false, ok: (value) => typeof value === "string" && value.length > 0 },
  [CONTACTS_BACKUP_KEY]: { list: true, ok: isValidContact },
  "local:networkSettings": { list: false, ok: isValidNetworkSettings },
  "local:displaySettings": { list: false, ok: isDisplaySettings },
  "local:themeSettings": { list: false, ok: isThemeRecord },
  "local:lockSettings": { list: false, ok: isLockSettings },
  "local:securityPhrase": { list: false, ok: (value) => readSecurityPhrase(value) !== null },
  "local:passkey": { list: false, ok: isPasskeyEnrollment },
  [SAVED_SITES_BACKUP_KEY]: { list: true, ok: isExactHttpOrigin },
};

const WATCHED_TOKENS_RULE: BackupRule = { list: true, ok: isTokenId };

/** The storage keys a backup always looks at; the watched-token keys follow from its wallets. */
export const BACKUP_KEYS: readonly string[] = Object.keys(RULES);

export function watchedTokensBackupKey(address: string): string {
  return `${WATCHED_TOKENS_BACKUP_PREFIX}${address}`;
}

function ruleFor(key: string): BackupRule | null {
  if (Object.hasOwn(RULES, key)) return RULES[key]!;
  if (key.startsWith(WATCHED_TOKENS_BACKUP_PREFIX)) {
    return isValidArweaveAddress(key.slice(WATCHED_TOKENS_BACKUP_PREFIX.length)) ? WATCHED_TOKENS_RULE : null;
  }
  return null;
}

/** Whether a change to this storage key changes what a backup holds. */
export function isBackedUpKey(key: string): boolean {
  return ruleFor(key) !== null;
}

/**
 * What a stored value contributes to a backup: the value, a list without
 * its malformed items, or `undefined` for a key that isn't backed up or a
 * value that doesn't pass its guard. Storage may hold a shape an older
 * release wrote, and that must not make the whole backup unrestorable.
 */
export function backupValueOf(key: string, stored: unknown): unknown {
  const rule = ruleFor(key);
  if (!rule || stored === null || stored === undefined) return undefined;
  if (!rule.list) return rule.ok(stored) ? stored : undefined;
  if (!Array.isArray(stored)) return undefined;
  const items: unknown[] = stored.filter((item) => rule.ok(item));
  return items.length > 0 ? items : undefined;
}

export function walletsOf(data: BackupData): Wallet[] {
  const wallets = data[WALLETS_BACKUP_KEY];
  return Array.isArray(wallets) ? (wallets as Wallet[]) : [];
}

/**
 * Whether every value is one Gleam could have stored. Strict, unlike
 * `backupValueOf`: on restore one malformed value refuses the whole
 * backup. A key this release doesn't know is allowed here and never
 * written (`writeBackupData`), so a newer release's file still restores.
 */
export function isValidBackupData(value: unknown): value is BackupData {
  if (!isPlainRecord(value)) return false;
  const data = value as BackupData;
  for (const [key, entry] of Object.entries(data)) {
    const rule = ruleFor(key);
    if (!rule) continue;
    const valid = rule.list ? Array.isArray(entry) && entry.every((item) => rule.ok(item)) : rule.ok(entry);
    if (!valid) return false;
  }
  const active = data[ACTIVE_WALLET_BACKUP_KEY];
  return active === undefined || walletsOf(data).some((wallet) => wallet.id === active);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function isBackupStamp(value: unknown): value is BackupStamp {
  if (!isRecord(value)) return false;
  const { v, backupId, updatedAt, writer } = value;
  return (
    v === BACKUP_FORMAT_VERSION &&
    typeof backupId === "string" &&
    ID_PATTERN.test(backupId) &&
    typeof updatedAt === "number" &&
    Number.isSafeInteger(updatedAt) &&
    updatedAt >= 0 &&
    typeof writer === "string" &&
    ID_PATTERN.test(writer)
  );
}

function isWrappedKey(value: unknown): value is VaultEnvelopeV2 {
  if (!isRecord(value)) return false;
  const key = value;
  return (
    key.version === 2 &&
    key.algorithm === "AES-GCM" &&
    key.kdf === "Argon2id" &&
    typeof key.memoryKiB === "number" &&
    typeof key.iterations === "number" &&
    typeof key.parallelism === "number" &&
    typeof key.salt === "string" &&
    typeof key.iv === "string" &&
    typeof key.ciphertext === "string"
  );
}

export function isValidBackupHeader(value: unknown): value is BackupHeader {
  return isBackupStamp(value) && isWrappedKey((value as { wrapped?: unknown }).wrapped);
}

function isBackupPasskey(value: unknown): value is BackupPasskey {
  if (!isRecord(value)) return false;
  const { credentialId, prfSalt, iv, ciphertext } = value;
  return [credentialId, prfSalt, iv, ciphertext].every((field) => typeof field === "string" && field.length > 0);
}

/**
 * The header's passkeys, keeping only well-formed ones. A bad entry costs
 * only itself: the password still restores.
 */
function readBackupPasskeys(value: unknown): BackupPasskey[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isBackupPasskey)
    .slice(0, MAX_BACKUP_DEVICES)
    .map(({ credentialId, prfSalt, iv, ciphertext }) => ({ credentialId, prfSalt, iv, ciphertext }));
}

/**
 * The passkeys the installs in `devices` have enrolled, newest install
 * first and each credential once. Built from the decrypted body at write
 * time, never copied from a header, which nothing authenticates.
 */
export function backupPasskeysOf(devices: Record<string, BackupDevice>): BackupPasskey[] {
  const passkeys: BackupPasskey[] = [];
  for (const device of Object.values(devices).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const enrollment = device.data["local:passkey"];
    if (!isPasskeyEnrollment(enrollment) || passkeys.some((known) => known.credentialId === enrollment.credentialId)) continue;
    const { credentialId, prfSalt, iv, ciphertext } = enrollment;
    passkeys.push({ credentialId, prfSalt, iv, ciphertext });
  }
  return passkeys;
}

function isBackupDevice(value: unknown): value is BackupDevice {
  if (!isRecord(value)) return false;
  const { updatedAt, data } = value;
  return typeof updatedAt === "number" && Number.isSafeInteger(updatedAt) && isValidBackupData(data);
}

export function isValidBackupBody(value: unknown): value is BackupBody {
  if (!isBackupStamp(value)) return false;
  const devices = (value as { devices?: unknown }).devices;
  if (!isPlainRecord(devices)) return false;
  const entries = Object.entries(devices);
  return (
    entries.length <= MAX_BACKUP_DEVICES &&
    Object.hasOwn(devices, value.writer) &&
    entries.every(([writer, device]) => ID_PATTERN.test(writer) && isBackupDevice(device))
  );
}

/** Whether a decrypted body belongs under this header. A mismatch means the clear header was altered. */
export function bodyMatchesHeader(body: BackupStamp, header: BackupStamp): boolean {
  return body.backupId === header.backupId && body.updatedAt === header.updatedAt && body.writer === header.writer;
}

/** A random `backupId` or `writer`. */
export function newBackupId(): string {
  return crypto.randomUUID();
}

export function encodeBackupFile({ header, sealed }: BackupFile): Bytes {
  const { v, backupId, updatedAt, writer, wrapped, passkeys } = header;
  return new TextEncoder().encode(
    JSON.stringify({ v, backupId, updatedAt, writer, wrapped, ...(passkeys?.length ? { passkeys } : {}), body: bytesToBase64(sealed) }),
  );
}

/** The file's header and sealed body, or null for bytes that are not a backup this release can read. */
export function decodeBackupFile(bytes: Uint8Array): BackupFile | null {
  if (bytes.length > MAX_BACKUP_FILE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isValidBackupHeader(parsed)) return null;
    const { v, backupId, updatedAt, writer, wrapped } = parsed;
    const { body, passkeys: listed } = parsed as { body?: unknown; passkeys?: unknown };
    if (typeof body !== "string") return null;
    const passkeys = readBackupPasskeys(listed);
    return {
      header: { v, backupId, updatedAt, writer, wrapped, ...(passkeys.length > 0 ? { passkeys } : {}) },
      sealed: base64ToBytes(body),
    };
  } catch {
    return null;
  }
}

export function encodeBackupBody(body: BackupBody): Bytes {
  return new TextEncoder().encode(JSON.stringify(body));
}

/** A decrypted body, or null when it is not one. */
export function decodeBackupBody(bytes: Uint8Array): BackupBody | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isValidBackupBody(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
