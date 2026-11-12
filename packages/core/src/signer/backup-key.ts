import type { VaultEnvelope, VaultEnvelopeV2 } from "../models/wallet";
import { decryptFromEnvelope, encryptToEnvelope, VaultKdfError, type EncryptOptions, type VaultKeys } from "./envelope";
import { zeroize } from "./zeroize";

type Bytes = Uint8Array<ArrayBuffer>;

const BACKUP_KEY_BYTES = 32;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/**
 * The envelope's AAD names a wallet record. A backup key takes this fixed
 * id where a wallet's would go, with the backup's id as the address, so a
 * wrapped backup key opens only as the key of that backup.
 */
const ENVELOPE_RECORD_ID = "backup";

/** The key a backup's body is encrypted under: random, and never derived from the password. */
export function mintBackupKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(BACKUP_KEY_BYTES));
}

/**
 * Wraps a backup key under the vault password, in the Argon2id envelope
 * the wallets use. Zeroizes `raw`, as `encryptToEnvelope` does every
 * plaintext: import the key first.
 */
export function wrapBackupKey(
  raw: Bytes,
  password: string | VaultKeys,
  backupId: string,
  options?: EncryptOptions,
): Promise<VaultEnvelopeV2> {
  return encryptToEnvelope(raw, password, ENVELOPE_RECORD_ID, backupId, options);
}

/**
 * The backup key inside `wrapped`. Throws as `decryptFromEnvelope` does:
 * a plain `Error` for a wrong password, `VaultKdfError` for anything
 * else. The caller zeroizes the result.
 */
export async function unwrapBackupKey(
  wrapped: VaultEnvelope,
  password: string | VaultKeys,
  backupId: string,
): Promise<Bytes> {
  const raw = (await decryptFromEnvelope(wrapped, password, ENVELOPE_RECORD_ID, backupId)) as Bytes;
  if (raw.length !== BACKUP_KEY_BYTES) {
    zeroize(raw);
    throw new VaultKdfError("This backup's key is corrupted and can't be read.");
  }
  return raw;
}

/** A non-extractable handle on a backup key. The caller zeroizes `raw`. */
export function importBackupKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== BACKUP_KEY_BYTES) throw new Error("A backup key is 32 bytes.");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function bodyAad(backupId: string): Bytes {
  return new TextEncoder().encode(`gleam:backup-body:v1:${backupId}`);
}

/** Encrypts a backup body: a fresh IV, then the AES-256-GCM ciphertext bound to this backup's id. */
export async function sealBackup(key: CryptoKey, plaintext: Bytes, backupId: string): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: bodyAad(backupId) }, key, plaintext);
  const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  sealed.set(iv);
  sealed.set(new Uint8Array(ciphertext), IV_BYTES);
  return sealed;
}

/** The body `sealBackup` encrypted. Throws when the key, the backup id or any byte differs. */
export async function openBackup(key: CryptoKey, sealed: Bytes, backupId: string): Promise<Bytes> {
  if (sealed.length < IV_BYTES + GCM_TAG_BYTES) throw new Error("This backup is corrupted and can't be read.");
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES), additionalData: bodyAad(backupId) },
        key,
        sealed.subarray(IV_BYTES),
      ),
    );
  } catch {
    throw new Error("This backup is corrupted and can't be read.");
  }
}
