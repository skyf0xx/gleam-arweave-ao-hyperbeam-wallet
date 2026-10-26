import type { SessionKeyStorePort } from "@gleam/core";
import { Keyring } from "@gleam/core/signer";

/**
 * The unlocked wallets' keys, as non-extractable `CryptoKey`s in the
 * runtime worker's heap. Nothing here is written to disk, so the OS
 * killing the app locks every wallet. The UI thread can ask the runtime to
 * sign or decrypt but has no path to the keys: the worker answers only
 * `dispatch` (`worker/host.ts`).
 */
export function createWorkerSessionKeys(): SessionKeyStorePort {
  return new Keyring();
}
