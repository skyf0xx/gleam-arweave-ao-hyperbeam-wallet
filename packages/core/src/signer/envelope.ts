import { argon2id } from "hash-wasm";
import type { Argon2idParams, VaultEnvelope, VaultEnvelopeV2 } from "../models/wallet";
import { base64ToBytes, bytesToBase64 } from "../vault/base64";
import { zeroize } from "./zeroize";

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;
const AES_KEY_LENGTH_BYTES = 32;

/**
 * Argon2id cost for new envelopes. 64 MiB is RFC 9106's memory-constrained
 * recommendation and stays well inside an MV3 service worker's budget;
 * hash-wasm frees the WASM instance after each run. Five passes take about
 * 250 ms on an Apple M4 Pro under Node (V8, same engine as Chrome), which
 * is roughly 0.75–1 s on a mid-range laptop. hash-wasm computes lanes on
 * one thread, so parallelism above 1 would add no attacker cost.
 */
export const DEFAULT_ARGON2ID_PARAMS: Readonly<Argon2idParams> = {
  memoryKiB: 65_536,
  iterations: 5,
  parallelism: 1,
};

/**
 * Bounds on stored Argon2id params. A corrupted or hostile envelope must
 * not make the service worker allocate gigabytes or spin for minutes, and
 * hash-wasm needs at least 8 KiB of memory per lane. The caps leave 4x the
 * default memory and 2x its passes for raising the cost later.
 */
const MAX_ARGON2_MEMORY_KIB = 262_144;
const MAX_ARGON2_ITERATIONS = 10;
const MAX_ARGON2_PARALLELISM = 16;

export type KdfSpec =
  | { kdf: "PBKDF2-HMAC-SHA256"; salt: string }
  | ({ kdf: "Argon2id"; salt: string } & Argon2idParams);

/**
 * Binds ciphertext to the exact wallet record and envelope version it
 * belongs to, so an envelope moved onto a different wallet's record
 * (different `walletId`/`address`) fails with a GCM tag mismatch rather
 * than silently decrypting.
 */
function buildAAD(version: 1 | 2, walletId: string, address: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`gleam:v${version}:${walletId}:${address}`);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function isValidArgon2idParams(params: Argon2idParams): boolean {
  return (
    isIntegerInRange(params.parallelism, 1, MAX_ARGON2_PARALLELISM) &&
    isIntegerInRange(params.iterations, 1, MAX_ARGON2_ITERATIONS) &&
    isIntegerInRange(params.memoryKiB, 8 * params.parallelism, MAX_ARGON2_MEMORY_KIB)
  );
}

const UNREADABLE_FORMAT = "This wallet was saved in a format this version can't read.";
const CORRUPTED = "This wallet's saved data is corrupted and can't be read.";
const KDF_FAILED =
  "Gleam couldn't run its password check on this device, so it can't tell whether the password is right. Close other tabs or restart the browser, then try again.";

/**
 * Any failure other than a wrong password: an envelope this version can't
 * read, corrupted envelope fields, or a key derivation that failed to run
 * (WASM refused by CSP, Argon2id memory unavailable). Callers must not
 * report it as a wrong password, which would send the user to recovery
 * over a fault that retrying or updating can fix.
 */
export class VaultKdfError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VaultKdfError";
  }
}

function kdfSpecOf(envelope: VaultEnvelope): KdfSpec {
  if (envelope.algorithm !== "AES-GCM") throw new VaultKdfError(UNREADABLE_FORMAT);
  if (envelope.version === 1 && envelope.kdf === "PBKDF2-HMAC-SHA256") {
    return { kdf: envelope.kdf, salt: envelope.salt };
  }
  if (envelope.version === 2 && envelope.kdf === "Argon2id") {
    const { memoryKiB, iterations, parallelism, salt } = envelope;
    if (!isValidArgon2idParams({ memoryKiB, iterations, parallelism })) throw new VaultKdfError(CORRUPTED);
    return { kdf: envelope.kdf, memoryKiB, iterations, parallelism, salt };
  }
  throw new VaultKdfError(UNREADABLE_FORMAT);
}

function cacheKeyOf(spec: KdfSpec): string {
  return spec.kdf === "Argon2id"
    ? `argon2id:${spec.memoryKiB}:${spec.iterations}:${spec.parallelism}:${spec.salt}`
    : `pbkdf2:${spec.salt}`;
}

async function deriveKey(password: string, spec: KdfSpec): Promise<CryptoKey> {
  let salt: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(spec.salt);
  } catch {
    throw new VaultKdfError(CORRUPTED);
  }
  if (spec.kdf === "Argon2id" && salt.length < SALT_LENGTH_BYTES) throw new VaultKdfError(CORRUPTED);
  try {
    return await runKdf(password, spec, salt);
  } catch (error) {
    throw new VaultKdfError(KDF_FAILED, { cause: error });
  }
}

async function runKdf(password: string, spec: KdfSpec, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {

  const passwordBytes = new TextEncoder().encode(password);
  try {
    if (spec.kdf === "PBKDF2-HMAC-SHA256") {
      const keyMaterial = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
      return await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    }

    const raw = (await argon2id({
      password: passwordBytes,
      salt,
      memorySize: spec.memoryKiB,
      iterations: spec.iterations,
      parallelism: spec.parallelism,
      hashLength: AES_KEY_LENGTH_BYTES,
      outputType: "binary",
    })) as Uint8Array<ArrayBuffer>;
    try {
      return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    } finally {
      zeroize(raw);
    }
  } finally {
    zeroize(passwordBytes);
  }
}

/**
 * Non-extractable vault keys derived from one password, memoized by KDF,
 * params and salt. Wallets in one vault share a password and, once
 * re-encrypted together, a salt, so one Argon2id run serves every envelope
 * an unlock, create or upgrade touches. Scope an instance to a single
 * operation; it holds the password.
 */
export class VaultKeys {
  private readonly keys = new Map<string, Promise<CryptoKey>>();

  constructor(private readonly password: string) {}

  derive(spec: KdfSpec): Promise<CryptoKey> {
    const cacheKey = cacheKeyOf(spec);
    let key = this.keys.get(cacheKey);
    if (!key) {
      key = deriveKey(this.password, spec);
      this.keys.set(cacheKey, key);
      // A failed derivation must not poison later attempts.
      key.catch(() => this.keys.delete(cacheKey));
    }
    return key;
  }
}

/** A random base64 salt for `EncryptOptions.salt`. */
export function newVaultSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES)));
}

function keysFor(password: string | VaultKeys): VaultKeys {
  return typeof password === "string" ? new VaultKeys(password) : password;
}

export interface EncryptOptions {
  /** Argon2id cost; defaults to `DEFAULT_ARGON2ID_PARAMS`. */
  params?: Argon2idParams;
  /**
   * Base64 salt to reuse, so wallets in one vault share a single key
   * derivation. A fresh random salt is generated when omitted.
   */
  salt?: string;
}

/**
 * Encrypts `plaintext` (e.g. a serialized JWK) into a version 2
 * `VaultEnvelope`.
 *
 * Never use `arweave.crypto.encrypt()` for this: arweave-js's own helper
 * is PBKDF2-100k → AES-CBC with a literal `"salt"` default, weaker on
 * every axis, and exists only for dApp-facing `encrypt()`/`decrypt()`
 * interop.
 */
export async function encryptToEnvelope(
  plaintext: Uint8Array<ArrayBuffer>,
  password: string | VaultKeys,
  walletId: string,
  address: string,
  options: EncryptOptions = {},
): Promise<VaultEnvelopeV2> {
  try {
    const params = options.params ?? DEFAULT_ARGON2ID_PARAMS;
    if (!isValidArgon2idParams(params)) throw new Error("Invalid Argon2id parameters.");
    const salt = options.salt ?? newVaultSalt();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const { memoryKiB, iterations, parallelism } = params;

    const key = await keysFor(password).derive({ kdf: "Argon2id", memoryKiB, iterations, parallelism, salt });
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: buildAAD(2, walletId, address) },
      key,
      plaintext,
    );

    return {
      version: 2,
      algorithm: "AES-GCM",
      kdf: "Argon2id",
      memoryKiB,
      iterations,
      parallelism,
      salt,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
  } finally {
    zeroize(plaintext);
  }
}

/**
 * Decrypts a `VaultEnvelope` of either version back into its plaintext
 * bytes, never a silently-wrong plaintext. A GCM tag failure throws a
 * plain `Error`: the password is wrong, the ciphertext, salt or KDF params
 * were altered, or the envelope was moved to a different wallet record
 * (AAD mismatch). A malformed or unreadable envelope, or a key derivation
 * that couldn't run, throws `VaultKdfError`.
 */
export async function decryptFromEnvelope(
  envelope: VaultEnvelope,
  password: string | VaultKeys,
  walletId: string,
  address: string,
): Promise<Uint8Array> {
  const spec = kdfSpecOf(envelope);

  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = base64ToBytes(envelope.iv);
    ciphertext = base64ToBytes(envelope.ciphertext);
  } catch {
    throw new VaultKdfError(CORRUPTED);
  }
  // A wrong-length IV would fail inside AES-GCM and read as a wrong password.
  if (iv.length !== IV_LENGTH_BYTES) throw new VaultKdfError(CORRUPTED);

  const key = await keysFor(password).derive(spec);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: buildAAD(envelope.version, walletId, address) },
      key,
      ciphertext,
    );
  } catch {
    throw new Error("That password didn't unlock this wallet. Try again, or use your recovery method.");
  } finally {
    zeroize(ciphertext);
  }

  return new Uint8Array(plaintext);
}

/** Whether `envelope` should be re-encrypted at `params` the next time its password is known. */
export function envelopeNeedsUpgrade(
  envelope: VaultEnvelope,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): boolean {
  if (envelope.version !== 2) return true;
  return (
    envelope.memoryKiB < params.memoryKiB ||
    envelope.iterations < params.iterations ||
    envelope.parallelism < params.parallelism
  );
}
