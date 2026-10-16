import type { JWKInterface } from "../models/wallet";
import type { RsaPssSignParams } from "../vault/signer";

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Holds unlocked wallets' private keys, keyed by wallet id, and performs
 * the private-key operations with them. Callers hand a JWK over once, at
 * unlock, and from then on get only signatures and plaintexts back: the
 * port has no way to read a key out.
 *
 * `Keyring` (`signer/keyring.ts`) is the in-memory implementation. The
 * extension runs it inside an offscreen document and reaches it through
 * `apps/extension/src/adapters/offscreen-keyring.ts`.
 */
export interface SessionKeyStorePort {
  importKey(walletId: string, jwk: JWKInterface): Promise<void>;
  /** RSA-PSS over `data` exactly as given. Rejects for a wallet with no key. */
  sign(walletId: string, params: RsaPssSignParams, data: Bytes): Promise<Bytes>;
  /** RSA-OAEP/SHA-256. Rejects for a wallet with no key. */
  decrypt(walletId: string, ciphertext: Bytes, label?: Bytes): Promise<Bytes>;
  /** The subset of `walletIds` that currently has a key. */
  has(walletIds: readonly string[]): Promise<string[]>;
  remove(walletId: string): Promise<void>;
  clear(): Promise<void>;
}
