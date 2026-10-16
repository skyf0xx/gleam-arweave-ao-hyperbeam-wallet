import type { MessageHashAlgorithm } from "./message-signing";

type Bytes = Uint8Array<ArrayBuffer>;

export interface RsaPssSignParams {
  /** The hash the key is bound to, used for both PSS's message digest and MGF1. */
  hash: MessageHashAlgorithm;
  saltLength: number;
}

/**
 * The private-key operations a wallet's RSA key performs, without exposing
 * the key. Everything outside `core/signer` and its importers signs
 * through one of these, so callers never see where the key behind it is
 * held.
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
}
