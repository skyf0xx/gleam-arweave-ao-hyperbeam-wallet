import type { Contact } from "../models/contact";
import type { Wallet } from "../models/wallet";
import type { StoragePort } from "../ports/storage";

/** A `StoragePort` over a `Map`, for this folder's tests. */
export function memoryStorage(initial: Record<string, unknown> = {}): StoragePort & { entries(): Record<string, unknown> } {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    async get<T>(key: string) {
      return (values.get(key) as T | undefined) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async setMany(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
    watch() {
      return () => {};
    },
    entries: () => Object.fromEntries(values),
  };
}

export function address(seed: string): string {
  return seed.repeat(43).slice(0, 43);
}

export function keyfileWallet(id: string, overrides: Partial<Wallet> = {}): Wallet {
  return {
    id,
    address: address(id),
    name: `Wallet ${id}`,
    method: "jwk",
    publicKey: "n",
    createdAt: 1,
    updatedAt: 1,
    encryptedKeyfile: {
      version: 2,
      algorithm: "AES-GCM",
      kdf: "Argon2id",
      memoryKiB: 65_536,
      iterations: 5,
      parallelism: 1,
      salt: "c2FsdA==",
      iv: "aXY=",
      ciphertext: "Y2lwaGVy",
    },
    backupConfirmedAt: null,
    ...overrides,
  };
}

export function contact(seed: string, overrides: Partial<Contact> = {}): Contact {
  return { address: address(seed), name: `Contact ${seed}`, createdAt: 1, ...overrides };
}
