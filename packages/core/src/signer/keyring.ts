import type { JWKInterface } from "../models/wallet";
import type { SessionKeyStorePort } from "../ports/session-keys";
import type { RsaPssSignParams } from "../vault/signer";
import { decryptOaepWithHandles, importSessionKeys, signPssWithHandles, type SessionKeyHandles } from "./keys";

type Bytes = Uint8Array<ArrayBuffer>;

export class KeyringLockedError extends Error {
  constructor() {
    super("This wallet is locked. Unlock Gleam and try again.");
    this.name = "KeyringLockedError";
  }
}

/**
 * Unlocked wallets' keys as non-extractable `CryptoKey`s in a plain `Map`,
 * so they exist only in this JS heap. Nothing here persists: not
 * IndexedDB, which would write the key material into the browser profile,
 * and not `chrome.storage`, which can't hold a `CryptoKey`.
 */
export class Keyring implements SessionKeyStorePort {
  private readonly keys = new Map<string, SessionKeyHandles>();

  async importKey(walletId: string, jwk: JWKInterface): Promise<void> {
    if (!jwk.d) throw new Error("This keyfile has no private key.");
    this.keys.set(walletId, await importSessionKeys(jwk));
  }

  async sign(walletId: string, params: RsaPssSignParams, data: Bytes): Promise<Bytes> {
    return signPssWithHandles(this.handles(walletId), data, params);
  }

  async decrypt(walletId: string, ciphertext: Bytes, label?: Bytes): Promise<Bytes> {
    return decryptOaepWithHandles(this.handles(walletId), ciphertext, label?.slice().buffer);
  }

  async has(walletIds: readonly string[]): Promise<string[]> {
    return walletIds.filter((walletId) => this.keys.has(walletId));
  }

  async remove(walletId: string): Promise<void> {
    this.keys.delete(walletId);
  }

  async clear(): Promise<void> {
    this.keys.clear();
  }

  private handles(walletId: string): SessionKeyHandles {
    const handles = this.keys.get(walletId);
    if (!handles) throw new KeyringLockedError();
    return handles;
  }
}
