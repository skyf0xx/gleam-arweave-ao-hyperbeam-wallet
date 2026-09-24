import type { JWKInterface } from "../models/wallet";
import type { EncryptAlgorithm } from "../models/signing";

/**
 * `encrypt()`/`decrypt()` provider methods, implemented over WebCrypto's
 * `crypto.subtle`.
 *
 * For `RSA-OAEP` (the dominant real-world case — Wander's own
 * implementation uses the wallet's RSA keypair): the wallet's JWK *is*
 * an RSA keypair already, so encrypt/decrypt import it directly as a
 * WebCrypto `CryptoKey` rather than deriving a separate symmetric key.
 * `AES-CTR`/`AES-CBC`/`AES-GCM` are supported too, but since the wallet
 * holds no independent AES key, those paths derive a deterministic
 * AES-256 key from the JWK's RSA private exponent (`d`) via HKDF-SHA256
 * — this construction isn't specified by any Arweave/ArConnect
 * convention, and RSA-OAEP is the one real path a caller should expect.
 */

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function readBuffer(value: unknown, field: string, required: boolean): ArrayBuffer | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required.`);
    return undefined;
  }
  if (isArrayBuffer(value)) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  }
  throw new Error(`${field} must be an ArrayBuffer or Uint8Array.`);
}

function readInteger(value: unknown, field: string, required: boolean): number | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer.`);
  }
  return value;
}

/**
 * Builds a fresh WebCrypto params object holding only the fields that are
 * set. Chrome rejects an optional member that is present but not a
 * BufferSource, even `label: undefined`, so absent optionals must be
 * missing keys, not `undefined` or `null` values.
 */
export function normalizeEncryptAlgorithm(value: unknown): EncryptAlgorithm {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error('The algorithm must be an object, for example { name: "RSA-OAEP" }.');
  }
  const raw = value as Record<string, unknown>;
  switch (raw.name) {
    case "RSA-OAEP": {
      const label = readBuffer(raw.label, "RSA-OAEP label", false);
      return label ? { name: "RSA-OAEP", label } : { name: "RSA-OAEP" };
    }
    case "AES-CTR":
      return {
        name: "AES-CTR",
        counter: readBuffer(raw.counter, "AES-CTR counter", true)!,
        length: readInteger(raw.length, "AES-CTR length", true)!,
      };
    case "AES-CBC":
      return { name: "AES-CBC", iv: readBuffer(raw.iv, "AES-CBC iv", true)! };
    case "AES-GCM": {
      const additionalData = readBuffer(raw.additionalData, "AES-GCM additionalData", false);
      const tagLength = readInteger(raw.tagLength, "AES-GCM tagLength", false);
      return {
        name: "AES-GCM",
        iv: readBuffer(raw.iv, "AES-GCM iv", true)!,
        ...(additionalData ? { additionalData } : {}),
        ...(tagLength !== undefined ? { tagLength } : {}),
      };
    }
    default:
      throw new Error(`Unsupported encryption algorithm "${String(raw.name)}".`);
  }
}

async function importRsaPublicKey(jwk: JWKInterface): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, e: jwk.e, n: jwk.n, alg: "RSA-OAEP-256", ext: true },
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

async function importRsaPrivateKey(jwk: JWKInterface): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { ...jwk, alg: "RSA-OAEP-256", ext: true },
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

/**
 * Derives a deterministic, non-extractable AES `CryptoKey` from the JWK's
 * RSA private exponent `d` via HKDF-SHA256 — the wallet's only source of
 * private key material for algorithms that need a symmetric key rather
 * than an RSA keypair. No ArConnect/Wander convention defines an AES
 * path for `encrypt()`/`decrypt()`, since real usage is RSA-OAEP; this
 * exists only so the full `EncryptAlgorithm` union type-checks against a
 * real implementation rather than a stub.
 */
async function resolveAesKey(
  jwk: JWKInterface,
  algorithm: EncryptAlgorithm,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwk.d),
    "HKDF",
    false,
    ["deriveKey"],
  );

  const keyAlgorithm =
    algorithm.name === "AES-CTR"
      ? { name: "AES-CTR", length: 256 }
      : algorithm.name === "AES-CBC"
        ? { name: "AES-CBC", length: 256 }
        : { name: "AES-GCM", length: 256 };

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("gleam:v1:vault-aes"),
      info: new TextEncoder().encode(jwk.n),
    },
    keyMaterial,
    keyAlgorithm,
    false,
    [usage],
  );
}

export async function encrypt(
  jwk: JWKInterface,
  plaintext: Uint8Array<ArrayBuffer>,
  algorithm: EncryptAlgorithm,
): Promise<Uint8Array> {
  const params = normalizeEncryptAlgorithm(algorithm);
  const key =
    params.name === "RSA-OAEP" ? await importRsaPublicKey(jwk) : await resolveAesKey(jwk, params, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(params, key, plaintext);
  return new Uint8Array(ciphertext);
}

export async function decrypt(
  jwk: JWKInterface,
  ciphertext: Uint8Array<ArrayBuffer>,
  algorithm: EncryptAlgorithm,
): Promise<Uint8Array> {
  const params = normalizeEncryptAlgorithm(algorithm);
  const key =
    params.name === "RSA-OAEP" ? await importRsaPrivateKey(jwk) : await resolveAesKey(jwk, params, "decrypt");
  const plaintext = await crypto.subtle.decrypt(params, key, ciphertext);
  return new Uint8Array(plaintext);
}
