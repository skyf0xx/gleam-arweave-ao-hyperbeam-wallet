export type { JWKInterface } from "arweave/web/lib/wallet";

/**
 * A stored key record. Only `jwk` is currently produced; `ethereum`/
 * `ledger` are modeled now so the discriminated union stays stable for
 * callers once those methods land.
 */
export type WalletMethod = "jwk" | "ethereum" | "ledger";

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
   * Absent for `ledger` wallets, which store no key material at all.
   */
  encryptedKeyfile: VaultEnvelope | null;
  /**
   * Set only once a keyfile download or clipboard copy actually succeeds,
   * not merely offered. `null` for a wallet never backed up, including
   * every record stored before this field existed.
   */
  backupConfirmedAt: number | null;
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
