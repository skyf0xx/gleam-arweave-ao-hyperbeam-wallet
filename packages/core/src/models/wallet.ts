export type { JWKInterface } from "arweave/web/lib/wallet";

/**
 * A stored key record. `jwk` wallets hold an encrypted keyfile.
 * `keystone`/`ledger` are hardware wallets: Gleam stores only the public
 * key and signing happens on the device. `watch` is only an address the
 * user follows, with no key anywhere, so it can't sign at all. `ethereum`
 * is modeled but not produced yet.
 */
export type WalletMethod = "jwk" | "ethereum" | "ledger" | "keystone" | "watch";

export type HardwareWalletMethod = "keystone" | "ledger";

/**
 * What Gleam remembers about the device behind a hardware wallet. `xfp`
 * is the Keystone master fingerprint (8 hex characters), which a later
 * sign request must carry so the device can match it to its seed.
 */
export type HardwareDevice =
  | { kind: "keystone"; xfp: string }
  | {
      kind: "ledger";
      model?: string;
      appVersion?: string;
      /** Which Arweave app was open when connected. Informational only. */
      app?: "Arweave" | "Permaweb";
    };

export function isHardwareWalletMethod(method: WalletMethod): method is HardwareWalletMethod {
  return method === "keystone" || method === "ledger";
}

export function isWatchWalletMethod(method: WalletMethod): boolean {
  return method === "watch";
}

/** Hardware and watch wallets: Gleam holds no key for them, so there is nothing to unlock. */
export function isKeylessWalletMethod(method: WalletMethod): boolean {
  return isHardwareWalletMethod(method) || isWatchWalletMethod(method);
}

/**
 * Whether Gleam has a password to lock behind. Only keyfile wallets are
 * encrypted under one; a vault of hardware and watch wallets has nothing
 * to lock.
 */
export function vaultHasPassword(wallets: readonly { method: WalletMethod }[]): boolean {
  return wallets.some((wallet) => !isKeylessWalletMethod(wallet.method));
}

export interface Wallet {
  id: string;
  address: string;
  name: string;
  method: WalletMethod;
  publicKey: string;
  createdAt: number;
  updatedAt: number;
  /**
   * The encrypted Vault envelope wrapping this Wallet's key material.
   * `null` for hardware and watch wallets, which store no key material at all.
   */
  encryptedKeyfile: VaultEnvelope | null;
  /**
   * Set only once a keyfile download or clipboard copy actually succeeds,
   * not merely offered. `null` for a wallet never backed up, including
   * every record stored before this field existed.
   */
  backupConfirmedAt: number | null;
  /** Set only on hardware wallets. */
  device?: HardwareDevice;
}

/**
 * The subset of a Wallet safe to return across the messaging boundary
 * for lifecycle calls (create/import/switch) — never includes
 * `encryptedKeyfile`.
 */
export interface WalletSummary {
  id: string;
  address: string;
  name: string;
  method: WalletMethod;
  publicKey: string;
  createdAt: number;
  updatedAt: number;
  backupConfirmedAt: number | null;
  device?: HardwareDevice;
}

/**
 * The encryption envelope wrapping a Wallet's key material: a password KDF
 * deriving a non-extractable AES-256-GCM key, random salt/IV, record-bound
 * AAD (`gleam:v<version>:<walletId>:<address>`).
 *
 * New envelopes are version 2 (Argon2id). Version 1 (PBKDF2) is only read,
 * and is re-encrypted as version 2 on the next unlock.
 */
export type VaultEnvelope = VaultEnvelopeV1 | VaultEnvelopeV2;

export interface VaultEnvelopeV1 {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-HMAC-SHA256";
  iterations: 600_000;
  /** Base64-encoded random salt used in key derivation. */
  salt: string;
  /** Base64-encoded random initialization vector. */
  iv: string;
  /** Base64-encoded ciphertext of the JWK keyfile. */
  ciphertext: string;
}

/** The Argon2id cost, stored per envelope so it can be raised later. */
export interface Argon2idParams {
  /** Memory cost in KiB. */
  memoryKiB: number;
  /** Time cost (passes over memory). */
  iterations: number;
  parallelism: number;
}

export interface VaultEnvelopeV2 extends Argon2idParams {
  version: 2;
  algorithm: "AES-GCM";
  kdf: "Argon2id";
  /** Base64-encoded random salt used in key derivation. */
  salt: string;
  /** Base64-encoded random initialization vector. */
  iv: string;
  /** Base64-encoded ciphertext of the JWK keyfile. */
  ciphertext: string;
}
