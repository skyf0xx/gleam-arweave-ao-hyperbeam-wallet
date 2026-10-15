import type { JWKInterface } from "../models/wallet";
import type { EncryptAlgorithm } from "../models/signing";
import type { MessageHashAlgorithm } from "./message-signing";

type Bytes = Uint8Array<ArrayBuffer>;

export interface RsaPssSignParams {
  /** The hash the key is bound to, used for both PSS's message digest and MGF1. */
  hash: MessageHashAlgorithm;
  saltLength: number;
}

/**
 * The private-key operations a wallet's RSA key performs, without exposing
 * the key. Everything outside `key-session.ts` and the unlock path signs
 * through one of these, so the key can move to a non-extractable
 * `CryptoKey` without touching any caller.
 */
export interface Signer {
  /** The wallet's address, as recorded when the key was unlocked. */
  readonly address: string;
  /** The base64url RSA modulus (`n`): Arweave's `owner`. */
  readonly owner: string;
  /** RSA-PSS signature over `data` exactly as given; any pre-hashing is the caller's. */
  signPss(data: Bytes, params: RsaPssSignParams): Promise<Bytes>;
  /** RSA-OAEP/SHA-256 decryption, with the optional OAEP label. */
  decryptOaep(ciphertext: Bytes, label?: ArrayBuffer): Promise<Bytes>;
  /** `digest(data || UTF-8(d))`, Wander's `privateHash` (see `message-signing.ts`). */
  privateHash(data: Bytes, hash: MessageHashAlgorithm): Promise<Bytes>;
}

// The Arweave RSA fields only: a stored JWK's `alg`/`key_ops`/`use` can
// contradict the RSA-PSS import (e.g. an `alg` of RSA-OAEP), and WebCrypto
// rejects the key if so.
function rsaPssPrivateJwk(jwk: JWKInterface): JsonWebKey {
  const { kty, n, e, d, p, q, dp, dq, qi } = jwk;
  return { kty, n, e, d, p, q, dp, dq, qi, ext: true };
}

/** A `Signer` over a decrypted keyfile JWK. The key is imported per call and never cached as a `CryptoKey`. */
export function signerFromJwk(jwk: JWKInterface, address: string): Signer {
  return {
    address,
    owner: jwk.n,

    async signPss(data, { hash, saltLength }) {
      const key = await crypto.subtle.importKey("jwk", rsaPssPrivateJwk(jwk), { name: "RSA-PSS", hash }, false, [
        "sign",
      ]);
      return new Uint8Array(await crypto.subtle.sign({ name: "RSA-PSS", saltLength }, key, data));
    },

    async decryptOaep(ciphertext, label) {
      const key = await crypto.subtle.importKey(
        "jwk",
        { ...jwk, alg: "RSA-OAEP-256", ext: true },
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["decrypt"],
      );
      // Chrome rejects `label: undefined`, so an absent label must be a missing key.
      const params: EncryptAlgorithm = label ? { name: "RSA-OAEP", label } : { name: "RSA-OAEP" };
      return new Uint8Array(await crypto.subtle.decrypt(params, key, ciphertext));
    },

    async privateHash(data, hash) {
      if (!jwk.d) {
        throw new Error("privateHash requires a wallet's private key material (JWK has no 'd' field).");
      }
      const privateExponentText = new TextEncoder().encode(jwk.d);
      const combined = new Uint8Array(data.byteLength + privateExponentText.byteLength);
      combined.set(data, 0);
      combined.set(privateExponentText, data.byteLength);
      try {
        return new Uint8Array(await crypto.subtle.digest(hash, combined));
      } finally {
        combined.fill(0);
        privateExponentText.fill(0);
      }
    },
  };
}
