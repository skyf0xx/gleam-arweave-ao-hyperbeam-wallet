import { base64UrlToBytes, normalizeEncryptAlgorithm, type EncryptAlgorithm } from "@gleam/core";
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
 * and the AES variants), rebuilt with only the fields that are set so a
 * `null` or `{}` from the page is dropped or rejected before an approval
 * window opens. Wander's deprecated `{ algorithm, hash, salt }`
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
  try {
    return normalizeEncryptAlgorithm(algorithm);
  } catch (error) {
    throw new Error(`${method}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface ProviderTransaction {
  data: Uint8Array<ArrayBuffer>;
  /** Decoded to UTF-8 text. */
  tags: Array<{ name: string; value: string }>;
  target?: string;
  quantity?: string;
  reward?: string;
  last_tx?: string;
}

const ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ATOMIC_AMOUNT_PATTERN = /^\d+$/;

function decodeBase64Url(value: string, what: string, method: string): Uint8Array<ArrayBuffer> {
  try {
    return base64UrlToBytes(value);
  } catch {
    throw new Error(`${method}: ${what} is not valid base64url.`);
  }
}

function decodeTagText(value: unknown, method: string): string {
  if (typeof value !== "string") {
    throw new Error(`${method}: every tag needs a string name and value.`);
  }
  const bytes = decodeBase64Url(value, "a tag", method);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${method}: tags must be UTF-8 text.`);
  }
}

/** arweave-js's `Transaction` defaults unset fields to `""`, so an empty string means "not set". */
function readOptionalString(value: unknown, field: string, method: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${method}: transaction ${field} must be a string.`);
  return value;
}

function readAtomicAmount(value: unknown, field: string, method: string): string | undefined {
  const amount = readOptionalString(value, field, method);
  if (amount !== undefined && !ATOMIC_AMOUNT_PATTERN.test(amount)) {
    throw new Error(`${method}: transaction ${field} must be a whole number of Winston.`);
  }
  return amount;
}

/**
 * Reads the transaction `sign` and `dispatch` receive. The provider sends
 * arweave-js's `Transaction.toJSON()`, where `data` and each tag name and
 * value are base64url. A plain object may carry `data` as bytes instead.
 */
export function readTransaction(value: unknown, method: "sign" | "dispatch"): ProviderTransaction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${method} requires a transaction.`);
  }
  const transaction = value as Record<string, unknown>;

  let data: Uint8Array<ArrayBuffer>;
  if (transaction.data === undefined || transaction.data === null) {
    data = new Uint8Array(0);
  } else if (typeof transaction.data === "string") {
    data = decodeBase64Url(transaction.data, "transaction data", method);
  } else {
    data = readBytes(transaction.data, "data");
  }

  if (transaction.tags !== undefined && !Array.isArray(transaction.tags)) {
    throw new Error(`${method}: transaction tags must be an array.`);
  }
  const tags = ((transaction.tags as unknown[] | undefined) ?? []).map((tag) => {
    if (tag === null || typeof tag !== "object") {
      throw new Error(`${method}: every tag needs a string name and value.`);
    }
    const { name, value: tagValue } = tag as { name?: unknown; value?: unknown };
    return { name: decodeTagText(name, method), value: decodeTagText(tagValue, method) };
  });

  const target = readOptionalString(transaction.target, "target", method);
  if (target !== undefined && !ADDRESS_PATTERN.test(target)) {
    throw new Error(`${method}: transaction target must be an Arweave address.`);
  }

  // A reward of "0" is what a default-constructed arweave-js Transaction
  // carries, and the network never accepts it, so the gateway's price is
  // fetched instead.
  const reward = readAtomicAmount(transaction.reward, "reward", method);

  return {
    data,
    tags,
    target,
    quantity: readAtomicAmount(transaction.quantity, "quantity", method),
    reward: reward === "0" ? undefined : reward,
    last_tx: readOptionalString(transaction.last_tx, "last_tx", method),
  };
}
