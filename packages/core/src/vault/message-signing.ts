import type { Signer } from "./signer";

/**
 * `signMessage()`/`verifyMessage()` over
 * WebCrypto, built the way Wander (and permawebOS) build them so a
 * signature from either wallet verifies with the other's `verifyMessage`
 * and with arweave-js's `crypto.verify`:
 *
 * - `signMessage` hashes the data with `hashAlgorithm` first, then signs
 *   that digest with RSA-PSS (same hash, salt length 32).
 * - `verifyMessage` recomputes the digest and checks it the same way.
 */

export type MessageHashAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

/** Wander's fixed salt length for `signMessage`/`verifyMessage`. */
const WANDER_SALT_LENGTH = 32;

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
  signer: Signer,
  data: ArrayBuffer,
  hashAlgorithm: MessageHashAlgorithm = "SHA-256",
): Promise<ArrayBuffer> {
  const digest = new Uint8Array(await crypto.subtle.digest(hashAlgorithm, data));
  return (await signer.signPss(digest, { hash: hashAlgorithm, saltLength: WANDER_SALT_LENGTH })).buffer;
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
