import type { JWKInterface } from "../models/wallet";

/**
 * `signMessage()`/`signature()`/`privateHash()`/`verifyMessage()`,
 * implemented over WebCrypto's `crypto.subtle` against the wallet's own
 * RSA JWK, matching arweave-js's own `crypto.sign`/`crypto.verify`
 * convention: RSA-PSS with a salt length equal to the digest size,
 * digest selectable via `hashAlgorithm` (default `SHA-256`).
 *
 * Design decisions flagged per this task's packet:
 *
 * - **`signature()`** is ArConnect-deprecated (superseded by `sign`/
 *   `signMessage`/`signDataItem`) but still implemented for real, per the
 *   HONESTY rule against stub methods. No documented behavioral
 *   difference from `signMessage` survives in any source this build has
 *   access to beyond "older, narrower API, no `hashAlgorithm` option" —
 *   implemented here as functionally equivalent to `signMessage` with
 *   the default `SHA-256` digest, since that's the only behavior
 *   consistent with both methods needing to verify against the same
 *   public key today.
 * - **`privateHash()`** is genuinely underspecified: this codebase has no
 *   access to Wander's exact construction. Implemented as
 *   `SHA-<hashAlgorithm>(data || privateExponent-bytes)` — the input data
 *   concatenated with the JWK's private exponent `d` decoded from
 *   base64url, then hashed with WebCrypto's `crypto.subtle.digest`. This
 *   makes the hash both data-dependent and wallet-key-dependent (two
 *   different wallets never produce the same hash for the same input,
 *   and the hash can't be reproduced without the private key), which is
 *   the one property the method's name implies, but the exact byte
 *   layout is this build's own reasonable choice, not a verified
 *   ArConnect-compatible one — a later layer integrating against a real
 *   dApp expecting bit-for-bit ArConnect parity should treat this as
 *   provisional.
 */

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const HASH_ALGORITHM_BITS: Record<"SHA-256" | "SHA-384" | "SHA-512", number> = {
  "SHA-256": 256,
  "SHA-384": 384,
  "SHA-512": 512,
};

async function importRsaPssPrivateKey(
  jwk: JWKInterface,
  hashAlgorithm: "SHA-256" | "SHA-384" | "SHA-512",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { ...jwk, alg: `PS${HASH_ALGORITHM_BITS[hashAlgorithm]}`, ext: true },
    { name: "RSA-PSS", hash: hashAlgorithm },
    false,
    ["sign"],
  );
}

async function importRsaPssPublicKey(
  jwk: Pick<JWKInterface, "kty" | "e" | "n">,
  hashAlgorithm: "SHA-256" | "SHA-384" | "SHA-512",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, e: jwk.e, n: jwk.n, alg: `PS${HASH_ALGORITHM_BITS[hashAlgorithm]}`, ext: true },
    { name: "RSA-PSS", hash: hashAlgorithm },
    false,
    ["verify"],
  );
}

/** Signs an arbitrary `ArrayBuffer` payload with the wallet's RSA-PSS key. */
export async function signMessage(
  jwk: JWKInterface,
  data: ArrayBuffer,
  hashAlgorithm: "SHA-256" | "SHA-384" | "SHA-512" = "SHA-256",
): Promise<ArrayBuffer> {
  const key = await importRsaPssPrivateKey(jwk, hashAlgorithm);
  const saltLength = HASH_ALGORITHM_BITS[hashAlgorithm] / 8;
  return crypto.subtle.sign({ name: "RSA-PSS", saltLength }, key, data);
}

/**
 * Legacy alias — see module doc comment for why this delegates to
 * `signMessage` with the default `SHA-256` digest.
 */
export async function signature(jwk: JWKInterface, data: ArrayBuffer): Promise<ArrayBuffer> {
  return signMessage(jwk, data, "SHA-256");
}

/**
 * Hashes `data` keyed by the wallet's private exponent — see module doc
 * comment for the exact construction and its provisional-parity caveat.
 */
export async function privateHash(
  jwk: JWKInterface,
  data: ArrayBuffer,
  hashAlgorithm: "SHA-256" | "SHA-384" | "SHA-512" = "SHA-256",
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
 * Verifies a signature produced by `signMessage`/`signature` against a
 * public key given as a base64url-encoded RSA modulus (`n`) — matching
 * the shape a dApp holds after `getActivePublicKey()`, per
 * `VerifyMessageRequest`'s `publicKey: string` field in `signing.ts`.
 */
export async function verifyMessage(
  publicKeyModulus: string,
  data: ArrayBuffer,
  signatureBytes: ArrayBuffer,
  hashAlgorithm: "SHA-256" | "SHA-384" | "SHA-512" = "SHA-256",
): Promise<boolean> {
  const key = await importRsaPssPublicKey(
    { kty: "RSA", e: "AQAB", n: publicKeyModulus },
    hashAlgorithm,
  );
  const saltLength = HASH_ALGORITHM_BITS[hashAlgorithm] / 8;
  return crypto.subtle.verify({ name: "RSA-PSS", saltLength }, key, signatureBytes, data);
}
