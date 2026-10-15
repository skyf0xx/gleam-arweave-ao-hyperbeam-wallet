import type { Signer } from "./signer";
import type { EncryptAlgorithm } from "../models/signing";

/**
 * `encrypt()`/`decrypt()` provider methods, built as Wander builds them
 * (`src/api/modules/{encrypt,decrypt}/*.background.ts`): the wallet's RSA
 * key is imported as RSA-OAEP/SHA-256 and the page's params object is
 * passed to WebCrypto as-is.
 *
 * Wander also accepts `AES-CTR`/`AES-CBC`/`AES-GCM` params, but hands them
 * to `crypto.subtle.encrypt` with that same RSA key, so WebCrypto always
 * throws. There is no AES result to match, so those names are refused
 * here with an explicit message.
 */

const AES_ALGORITHMS = new Set(["AES-CTR", "AES-CBC", "AES-GCM", "AES-KW"]);

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function readBuffer(value: unknown, field: string): ArrayBuffer | undefined {
  if (value === undefined || value === null) return undefined;
  if (isArrayBuffer(value)) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  }
  throw new Error(`${field} must be an ArrayBuffer or Uint8Array.`);
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
  if (raw.name === "RSA-OAEP") {
    const label = readBuffer(raw.label, "RSA-OAEP label");
    return label ? { name: "RSA-OAEP", label } : { name: "RSA-OAEP" };
  }
  if (typeof raw.name === "string" && AES_ALGORITHMS.has(raw.name)) {
    throw new Error(
      `${raw.name} is not supported. The wallet holds only an RSA key, so encrypt and decrypt use { name: "RSA-OAEP" }.`,
    );
  }
  throw new Error(`Unsupported encryption algorithm "${String(raw.name)}". Use { name: "RSA-OAEP" }.`);
}

/** `owner` is the base64url RSA modulus; Arweave keys always use e = 65537. */
async function importRsaPublicKey(owner: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", e: "AQAB", n: owner, alg: "RSA-OAEP-256", ext: true },
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

export async function encrypt(
  owner: string,
  plaintext: Uint8Array<ArrayBuffer>,
  algorithm: EncryptAlgorithm,
): Promise<Uint8Array> {
  const params = normalizeEncryptAlgorithm(algorithm);
  const key = await importRsaPublicKey(owner);
  const ciphertext = await crypto.subtle.encrypt(params, key, plaintext);
  return new Uint8Array(ciphertext);
}

export async function decrypt(
  signer: Signer,
  ciphertext: Uint8Array<ArrayBuffer>,
  algorithm: EncryptAlgorithm,
): Promise<Uint8Array> {
  const params = normalizeEncryptAlgorithm(algorithm);
  return signer.decryptOaep(ciphertext, params.label);
}
