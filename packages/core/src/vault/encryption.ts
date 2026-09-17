import type { JWKInterface } from "../models/wallet";
import type { EncryptAlgorithm } from "../models/signing";

/**
 * `encrypt()`/`decrypt()` provider methods, implemented over WebCrypto's
 * `crypto.subtle` (ambient in both an MV3 service worker and this
 * package's Vitest environment, per `envelope.ts`'s own precedent — no
 * polyfill).
 *
 * For `RSA-OAEP` (the dominant real-world case for an Arweave/AO wallet,
 * per this task's packet — Wander's own implementation uses the wallet's
 * RSA keypair): the wallet's JWK *is* an RSA keypair already, so
 * encrypt/decrypt import it directly as a WebCrypto `CryptoKey` via
 * `importKey("jwk", ...)` rather than deriving a separate symmetric key.
 * `AES-CTR`/`AES-CBC`/`AES-GCM` are supported too (the full
 * `EncryptAlgorithm` union `signing.ts` pins), but since the wallet holds
 * no independent AES key, those paths derive a deterministic AES-256 key
 * from the JWK's RSA private exponent (`d`) via HKDF-SHA256 — documented
 * inline below since this construction isn't specified by any Arweave/
 * ArConnect convention, and RSA-OAEP is the one real path a caller should
 * expect.
 */

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
 * than an RSA keypair. Documented design choice (flagged per this task's
 * packet as genuinely underspecified): no ArConnect/Wander convention
 * defines an AES path for `encrypt()`/`decrypt()`, since real usage is
 * RSA-OAEP; this exists only so the full `EncryptAlgorithm` union
 * type-checks against a real implementation rather than a stub.
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
  if (algorithm.name === "RSA-OAEP") {
    const key = await importRsaPublicKey(jwk);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "RSA-OAEP", label: algorithm.label },
      key,
      plaintext,
    );
    return new Uint8Array(ciphertext);
  }

  const key = await resolveAesKey(jwk, algorithm, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(algorithm, key, plaintext);
  return new Uint8Array(ciphertext);
}

export async function decrypt(
  jwk: JWKInterface,
  ciphertext: Uint8Array<ArrayBuffer>,
  algorithm: EncryptAlgorithm,
): Promise<Uint8Array> {
  if (algorithm.name === "RSA-OAEP") {
    const key = await importRsaPrivateKey(jwk);
    const plaintext = await crypto.subtle.decrypt(
      { name: "RSA-OAEP", label: algorithm.label },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  }

  const key = await resolveAesKey(jwk, algorithm, "decrypt");
  const plaintext = await crypto.subtle.decrypt(algorithm, key, ciphertext);
  return new Uint8Array(plaintext);
}
