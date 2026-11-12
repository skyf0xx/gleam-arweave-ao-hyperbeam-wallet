import { isValidArweaveAddress, isValidContact } from "../models/contact";
import { isDisplaySettings } from "../models/display";
import { isValidNetworkSettings } from "../models/network";
import { isPasskeyEnrollment } from "../models/passkey";
import { readSecurityPhrase } from "../models/security-phrase";
import { isLockSettings } from "../models/session";
import { isThemeSettings } from "../models/theme";
import { isValidWallet, type VaultEnvelopeV2, type Wallet } from "../models/wallet";
import { base64ToBytes, bytesToBase64 } from "../vault/base64";

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

/** The clear part of the file. `wrapped` is the backup key wrapped under the vault password. */
export interface BackupHeader extends BackupStamp {
  wrapped: VaultEnvelopeV2;
}

/** Storage values by storage key. */
export type BackupData = Record<string, unknown>;

/**
 * The encrypted part of the file. It repeats the stamp so the header,
 * which nothing authenticates, can be checked against it after decryption.
 */
export interface BackupBody extends BackupStamp {
  data: BackupData;
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

interface BackupRule {
  /** A list is checked item by item, so one bad item costs only itself when a backup is built. */
  list: boolean;
  ok(value: unknown): boolean;
}

function isWebOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}

function isTokenId(value: unknown): boolean {
  return typeof value === "string" && isValidArweaveAddress(value);
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
  "local:themeSettings": { list: false, ok: isThemeSettings },
  "local:lockSettings": { list: false, ok: isLockSettings },
  "local:securityPhrase": { list: false, ok: (value) => readSecurityPhrase(value) !== null },
  "local:passkey": { list: false, ok: isPasskeyEnrollment },
  "local:browserSavedSites": { list: true, ok: isWebOrigin },
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
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
  if (value === null || typeof value !== "object") return false;
  const { v, backupId, updatedAt, writer } = value as Record<string, unknown>;
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
  if (value === null || typeof value !== "object") return false;
  const key = value as Record<string, unknown>;
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

export function isValidBackupBody(value: unknown): value is BackupBody {
  return isBackupStamp(value) && isValidBackupData((value as { data?: unknown }).data);
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
  const { v, backupId, updatedAt, writer, wrapped } = header;
  return new TextEncoder().encode(JSON.stringify({ v, backupId, updatedAt, writer, wrapped, body: bytesToBase64(sealed) }));
}

/** The file's header and sealed body, or null for bytes that are not a backup this release can read. */
export function decodeBackupFile(bytes: Uint8Array): BackupFile | null {
  if (bytes.length > MAX_BACKUP_FILE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isValidBackupHeader(parsed)) return null;
    const { v, backupId, updatedAt, writer, wrapped } = parsed;
    const body = (parsed as { body?: unknown }).body;
    if (typeof body !== "string") return null;
    return { header: { v, backupId, updatedAt, writer, wrapped }, sealed: base64ToBytes(body) };
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
