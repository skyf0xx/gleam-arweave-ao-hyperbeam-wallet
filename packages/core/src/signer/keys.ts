import type { JWKInterface } from "../models/wallet";
import type { EncryptAlgorithm } from "../models/signing";
import type { MessageHashAlgorithm } from "../vault/message-signing";
import type { RsaPssSignParams, Signer } from "../vault/signer";
import type { SessionKeyStorePort } from "../ports/session-keys";

type Bytes = Uint8Array<ArrayBuffer>;

// The Arweave RSA fields only: a stored JWK's `alg`/`key_ops`/`use` can
// contradict the import (e.g. an `alg` of RSA-OAEP on a PSS import), and
// WebCrypto rejects the key if so.
function rsaPrivateJwk(jwk: JWKInterface): JsonWebKey {
  const { kty, n, e, d, p, q, dp, dq, qi } = jwk;
  return { kty, n, e, d, p, q, dp, dq, qi, ext: true };
}

function importPssKey(jwk: JWKInterface, hash: MessageHashAlgorithm): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", rsaPrivateJwk(jwk), { name: "RSA-PSS", hash }, false, ["sign"]);
}

function importOaepKey(jwk: JWKInterface): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { ...rsaPrivateJwk(jwk), alg: "RSA-OAEP-256" },
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

async function signPssWith(key: CryptoKey, data: Bytes, saltLength: number): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.sign({ name: "RSA-PSS", saltLength }, key, data));
}

async function decryptOaepWith(key: CryptoKey, ciphertext: Bytes, label?: ArrayBuffer): Promise<Bytes> {
  // Chrome rejects `label: undefined`, so an absent label must be a missing key.
  const params: EncryptAlgorithm = label ? { name: "RSA-OAEP", label } : { name: "RSA-OAEP" };
  return new Uint8Array(await crypto.subtle.decrypt(params, key, ciphertext));
}

/**
 * Generates a fresh Arweave keyfile: RSA-4096, public exponent 65537.
 * The result is plaintext key material, so callers encrypt it into a
 * `VaultEnvelope` before it touches any storage. The `CryptoKey` has to be
 * extractable for the export; it is dropped once the JWK is read out.
 */
export async function generateJWK(): Promise<JWKInterface> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 4096, publicExponent: new Uint8Array([0x01, 0x00, 0x01]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const { kty, e, n, d, p, q, dp, dq, qi } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (kty !== "RSA" || !e || !n || !d || !p || !q || !dp || !dq || !qi) throw new Error("Key generation returned an incomplete RSA key.");
  return { kty, e, n, d, p, q, dp, dq, qi };
}

/** A `Signer` over a decrypted keyfile JWK. The key is imported per call and never cached as a `CryptoKey`. */
export function signerFromJwk(jwk: JWKInterface, address: string): Signer {
  return {
    address,
    owner: jwk.n,
    async signPss(data, { hash, saltLength }) {
      return signPssWith(await importPssKey(jwk, hash), data, saltLength);
    },
    async decryptOaep(ciphertext, label) {
      return decryptOaepWith(await importOaepKey(jwk), ciphertext, label);
    },
  };
}

/**
 * Non-extractable handles to one wallet's private key. WebCrypto binds an
 * RSA-PSS key to a single hash, so there is one signing key per hash a
 * caller may ask for.
 */
export interface SessionKeyHandles {
  pss: Record<MessageHashAlgorithm, CryptoKey>;
  oaep: CryptoKey;
}

/** Imports a decrypted keyfile as `CryptoKey`s that can sign and decrypt but can't be exported. */
export async function importSessionKeys(jwk: JWKInterface): Promise<SessionKeyHandles> {
  const [pss256, pss384, pss512, oaep] = await Promise.all([
    importPssKey(jwk, "SHA-256"),
    importPssKey(jwk, "SHA-384"),
    importPssKey(jwk, "SHA-512"),
    importOaepKey(jwk),
  ]);
  return { pss: { "SHA-256": pss256, "SHA-384": pss384, "SHA-512": pss512 }, oaep };
}

export interface SessionSignerInfo {
  address: string;
  owner: string;
}

/** A `Signer` whose private-key operations run in a `SessionKeyStorePort`, which never hands the key back. */
export function signerFromKeyStore(store: SessionKeyStorePort, walletId: string, info: SessionSignerInfo): Signer {
  return {
    address: info.address,
    owner: info.owner,
    signPss(data, params) {
      return store.sign(walletId, params, data);
    },
    decryptOaep(ciphertext, label) {
      return store.decrypt(walletId, ciphertext, label ? new Uint8Array(label) : undefined);
    },
  };
}

/** Private-key operations over one wallet's imported handles. */
export function signPssWithHandles(keys: SessionKeyHandles, data: Bytes, { hash, saltLength }: RsaPssSignParams): Promise<Bytes> {
  return signPssWith(keys.pss[hash], data, saltLength);
}

export function decryptOaepWithHandles(keys: SessionKeyHandles, ciphertext: Bytes, label?: ArrayBuffer): Promise<Bytes> {
  return decryptOaepWith(keys.oaep, ciphertext, label);
}
