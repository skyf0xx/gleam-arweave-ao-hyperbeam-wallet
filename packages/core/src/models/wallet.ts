export type { JWKInterface } from "arweave/web/lib/wallet";

/**
 * A stored key record. `jwk` wallets hold an encrypted keyfile.
 * `keystone`/`ledger` are hardware wallets: Gleam stores only the public
 * key and signing happens on the device. `ethereum` is modeled but not
 * produced yet.
 */
export type WalletMethod = "jwk" | "ethereum" | "ledger" | "keystone";

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

/**
 * Whether Gleam has a password to lock behind. Only keyfile wallets are
 * encrypted under one; a vault of hardware wallets has nothing to lock.
 */
export function vaultHasPassword(wallets: readonly { method: WalletMethod }[]): boolean {
  return wallets.some((wallet) => !isHardwareWalletMethod(wallet.method));
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
   * `null` for hardware wallets, which store no key material at all.
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
 * The encryption envelope wrapping a Wallet's key material: PBKDF2-HMAC-SHA256
 * (600,000 iterations) deriving a non-extractable AES-256-GCM key, random
 * salt/IV, record-bound AAD (`gleam:v1:<walletId>:<address>`).
 */
export interface VaultEnvelope {
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
