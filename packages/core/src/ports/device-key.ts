import type { DevicePublicJwk } from "../points/identity";

export interface DeviceKey {
  /** RFC 7638 thumbprint of `publicKey`; the server's device id. */
  id: string;
  publicKey: DevicePublicJwk;
  /** Non-extractable: it can sign but its bytes can never be read back. */
  privateKey: CryptoKey;
}

/**
 * The install's Gleam Points device key. Implemented by
 * `apps/extension/src/adapters/device-key.ts` over IndexedDB.
 */
export interface DeviceKeyPort {
  /**
   * Returns the stored key, creating it on first use. Concurrent first
   * uses must resolve to the same key.
   */
  loadOrCreate(): Promise<DeviceKey>;
}
