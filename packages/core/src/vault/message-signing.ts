import type { JWKInterface } from "../models/wallet";
import { base64UrlToBytes } from "./base64";

/**
 * `signMessage()`/`signature()`/`privateHash()`/`verifyMessage()` over
 * WebCrypto, built the way Wander (and permawebOS) build them so a
 * signature from either wallet verifies with the other's `verifyMessage`
 * and with arweave-js's `crypto.verify`:
 *
 * - `signMessage` hashes the data with `hashAlgorithm` first, then signs
 *   that digest with RSA-PSS (same hash, salt length 32).
 * - `verifyMessage` recomputes the digest and checks it the same way.
 * - `signature` is the deprecated raw form: RSA-PSS/SHA-256 straight over
 *   the data, salt length from `saltLength` (default 32).
 *
 * `privateHash` is `digest(data || d)`, with `d` the private exponent
 * decoded from base64url.
 */

export type MessageHashAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

/** Wander's fixed salt length for `signMessage`/`verifyMessage`, and `signature`'s default. */
const WANDER_SALT_LENGTH = 32;

// A stored JWK's `alg`/`key_ops`/`use` can contradict the RSA-PSS import
// below (e.g. an `alg` of RSA-OAEP), and WebCrypto rejects the key if so.
function stripKeyUsageHints(jwk: JsonWebKey): JsonWebKey {
  const stripped: JsonWebKey = { ...jwk, ext: true };
  delete stripped.alg;
  delete stripped.key_ops;
  delete stripped.use;
  return stripped;
}

async function importRsaPssPrivateKey(jwk: JWKInterface, hash: MessageHashAlgorithm): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", stripKeyUsageHints(jwk as JsonWebKey), { name: "RSA-PSS", hash }, false, [
    "sign",
  ]);
}

async function importRsaPssPublicKey(publicKeyModulus: string, hash: MessageHashAlgorithm): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", e: "AQAB", n: publicKeyModulus, ext: true },
    { name: "RSA-PSS", hash },
    false,
    ["verify"],
  );
}

/** Signs the `hashAlgorithm` digest of `data`, as Wander's `signMessage` does. */
export async function signMessage(
  jwk: JWKInterface,
  data: ArrayBuffer,
  hashAlgorithm: MessageHashAlgorithm = "SHA-256",
): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest(hashAlgorithm, data);
  const key = await importRsaPssPrivateKey(jwk, hashAlgorithm);
  return crypto.subtle.sign({ name: "RSA-PSS", saltLength: WANDER_SALT_LENGTH }, key, digest);
}

export interface SignatureOptions {
  saltLength?: number;
}

/** Wander's deprecated `signature()`: RSA-PSS/SHA-256 over the raw data. */
export async function signature(
  jwk: JWKInterface,
  data: ArrayBuffer,
  options: SignatureOptions = {},
): Promise<ArrayBuffer> {
  const saltLength = options.saltLength ?? WANDER_SALT_LENGTH;
  if (!Number.isSafeInteger(saltLength) || saltLength < 0) {
    throw new Error(`saltLength must be a non-negative integer, got ${String(saltLength)}.`);
  }
  const key = await importRsaPssPrivateKey(jwk, "SHA-256");
  return crypto.subtle.sign({ name: "RSA-PSS", saltLength }, key, data);
}

/** Hashes `data` keyed by the wallet's private exponent — see module doc comment for the exact construction. */
export async function privateHash(
  jwk: JWKInterface,
  data: ArrayBuffer,
  hashAlgorithm: MessageHashAlgorithm = "SHA-256",
): Promise<ArrayBuffer> {
  if (!jwk.d) {
    throw new Error("privateHash requires a wallet's private key material (JWK has no 'd' field).");
  }
  const privateExponentBytes = base64UrlToBytes(jwk.d);
  const dataBytes = new Uint8Array(data);
  const combined = new Uint8Array(dataBytes.byteLength + privateExponentBytes.byteLength);
  combined.set(dataBytes, 0);
  combined.set(privateExponentBytes, dataBytes.byteLength);
  return crypto.subtle.digest(hashAlgorithm, combined);
}

/**
 * Verifies a `signMessage` signature against a public key given as its
 * base64url RSA modulus (`n`), the shape `getActivePublicKey()` returns.
 */
export async function verifyMessage(
  publicKeyModulus: string,
  data: ArrayBuffer,
  signatureBytes: ArrayBuffer,
  hashAlgorithm: MessageHashAlgorithm = "SHA-256",
): Promise<boolean> {
  const digest = await crypto.subtle.digest(hashAlgorithm, data);
  const key = await importRsaPssPublicKey(publicKeyModulus, hashAlgorithm);
  return crypto.subtle.verify({ name: "RSA-PSS", saltLength: WANDER_SALT_LENGTH }, key, signatureBytes, digest);
}
