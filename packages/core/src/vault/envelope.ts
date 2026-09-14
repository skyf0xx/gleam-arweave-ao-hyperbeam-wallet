import type { VaultEnvelope } from "../models/wallet";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { zeroize } from "./zeroize";

const KDF_ITERATIONS = 600_000;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

/**
 * Record-bound additional authenticated data. Binds ciphertext to the
 * exact wallet record it belongs to, so a vault envelope moved onto a
 * different wallet's record (different `walletId`/`address`) fails
 * decryption with a GCM tag mismatch rather than silently succeeding
 * (ARCHITECTURE.md §5).
 */
function buildAAD(walletId: string, address: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`gleam:v1:${walletId}:${address}`);
}

/**
 * Derives a non-extractable AES-GCM 256-bit CryptoKey directly from the
 * password via PBKDF2-HMAC-SHA256 — the raw derived key material is never
 * exposed to JS (ARCHITECTURE.md §5's explicit non-extractable
 * requirement). `crypto.subtle` is the ambient WebCrypto global, present
 * in both a Node test runner and an MV3 service worker with no polyfill.
 */
async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    zeroize(passwordBytes);
  }
}

/**
 * Encrypts `plaintext` (e.g. a serialized JWK) into a `VaultEnvelope`.
 *
 * Never use `arweave.crypto.encrypt()` for this: arweave-js's own helper
 * is PBKDF2-100k → AES-CBC with a literal `"salt"` default, weaker on
 * every axis, and exists only for dApp-facing `encrypt()`/`decrypt()`
 * interop (ARCHITECTURE.md §5).
 */
export async function encryptToEnvelope(
  plaintext: Uint8Array<ArrayBuffer>,
  password: string,
  walletId: string,
  address: string,
): Promise<VaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

  try {
    const key = await deriveKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: buildAAD(walletId, address) },
      key,
      plaintext,
    );

    return {
      version: 1,
      algorithm: "AES-GCM",
      kdf: "PBKDF2-HMAC-SHA256",
      iterations: KDF_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
  } finally {
    zeroize(plaintext);
  }
}

/**
 * Decrypts a `VaultEnvelope` back into its plaintext bytes. Throws if the
 * password is wrong, the envelope was moved to a different wallet record
 * (AAD mismatch), or the envelope is malformed — all surface as WebCrypto
 * GCM tag-verification failures or explicit shape errors, never as a
 * silently-wrong plaintext.
 */
export async function decryptFromEnvelope(
  envelope: VaultEnvelope,
  password: string,
  walletId: string,
  address: string,
): Promise<Uint8Array> {
  if (envelope.algorithm !== "AES-GCM" || envelope.kdf !== "PBKDF2-HMAC-SHA256") {
    throw new Error("Unsupported vault envelope algorithm or KDF.");
  }

  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(envelope.salt);
    iv = base64ToBytes(envelope.iv);
    ciphertext = base64ToBytes(envelope.ciphertext);
  } catch {
    throw new Error("Vault envelope is malformed (invalid base64).");
  }

  const key = await deriveKey(password, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: buildAAD(walletId, address) },
      key,
      ciphertext,
    );
  } catch {
    throw new Error(
      "Failed to unlock vault: wrong password or the vault does not belong to this wallet.",
    );
  } finally {
    zeroize(ciphertext);
  }

  return new Uint8Array(plaintext);
}
