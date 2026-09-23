import { base64UrlToBytes, type EncryptAlgorithm } from "@gleam/core";
import { decodeTaggedBinary, encodeTaggedBinary } from "@gleam/messaging/src/page-protocol.ts";

/**
 * Decodes what `window.arweaveWallet` sends for each provider method. The
 * provider posts named arguments (`{ data, options }`, `{ data, signature,
 * publicKey, options }`, …) with binary values as `TaggedBinary`, so this
 * is the one place those arguments become typed values the background can
 * act on.
 */

export type HashAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

const HASH_ALGORITHMS: readonly HashAlgorithm[] = ["SHA-256", "SHA-384", "SHA-512"];
const ENCRYPT_ALGORITHM_NAMES: readonly string[] = ["RSA-OAEP", "AES-CTR", "AES-CBC", "AES-GCM"];

export type ProviderArgs = Record<string, unknown>;

export function decodeProviderParams(params: unknown): ProviderArgs {
  const decoded = decodeTaggedBinary(params);
  if (decoded === null || decoded === undefined) return {};
  if (typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Provider call parameters must be an object.");
  }
  return decoded as ProviderArgs;
}

/** Binary results go back tagged, because extension messaging is JSON-only. */
export function encodeProviderResult(result: unknown): unknown {
  return encodeTaggedBinary(result);
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/**
 * Reads a binary argument. `strings` says how a string is accepted, if at
 * all: Wander's `encrypt` takes UTF-8 text, and `verifyMessage` takes a
 * base64url signature.
 */
export function readBytes(
  value: unknown,
  name: string,
  strings: "reject" | "utf8" | "base64url" = "reject",
): Uint8Array<ArrayBuffer> {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (isArrayBuffer(value)) {
    return new Uint8Array(value).slice();
  }
  if (typeof value === "string" && strings === "utf8") {
    return new TextEncoder().encode(value);
  }
  if (typeof value === "string" && strings === "base64url") {
    return base64UrlToBytes(value);
  }
  throw new Error(`"${name}" must be an ArrayBuffer or Uint8Array.`);
}

function readOptions(options: unknown, method: string): Record<string, unknown> | undefined {
  if (options === undefined || options === null) return undefined;
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new Error(`${method} options must be an object.`);
  }
  return options as Record<string, unknown>;
}

export function readHashAlgorithm(options: unknown, method: string): HashAlgorithm | undefined {
  const hashAlgorithm = readOptions(options, method)?.hashAlgorithm;
  if (hashAlgorithm === undefined) return undefined;
  if (!HASH_ALGORITHMS.includes(hashAlgorithm as HashAlgorithm)) {
    throw new Error(`${method} does not support hashAlgorithm "${String(hashAlgorithm)}". Use SHA-256, SHA-384 or SHA-512.`);
  }
  return hashAlgorithm as HashAlgorithm;
}

/**
 * Accepts the WebCrypto params object Wander takes (`{ name: "RSA-OAEP" }`
 * and the AES variants). Wander's deprecated `{ algorithm, hash, salt }`
 * form uses a hybrid RSA+AES construction this wallet does not implement,
 * so it is rejected rather than silently encrypted some other way.
 */
export function readEncryptAlgorithm(options: unknown, method: "encrypt" | "decrypt"): EncryptAlgorithm {
  const algorithm = readOptions(options, method);
  if (!algorithm) {
    throw new Error(`${method} requires an algorithm, for example { name: "RSA-OAEP" }.`);
  }
  if (typeof algorithm.name !== "string" && typeof algorithm.algorithm === "string") {
    throw new Error(
      `${method} does not support the deprecated { algorithm, hash, salt } options. Pass WebCrypto params such as { name: "RSA-OAEP" }.`,
    );
  }
  if (typeof algorithm.name !== "string" || !ENCRYPT_ALGORITHM_NAMES.includes(algorithm.name)) {
    throw new Error(`${method} does not support algorithm "${String(algorithm.name)}".`);
  }
  return algorithm as unknown as EncryptAlgorithm;
}
