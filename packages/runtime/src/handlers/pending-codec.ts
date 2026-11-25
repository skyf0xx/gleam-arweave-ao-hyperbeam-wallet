import { base64ToBytes, bytesToBase64, isPlainRecord } from "@gleam/core";
import { mapBinaryDeep } from "@gleam/messaging/src/page-protocol.ts";

/** A byte array in a pending record. */
interface StoredBinary {
  __gleamStored: "ArrayBuffer" | "Uint8Array";
  base64: string;
}

function isStoredBinary(value: unknown): value is StoredBinary {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<StoredBinary>;
  return (
    (candidate.__gleamStored === "ArrayBuffer" || candidate.__gleamStored === "Uint8Array") &&
    typeof candidate.base64 === "string"
  );
}

/**
 * Bytes go in as base64 rather than the tagged-binary codec's number
 * arrays: `chrome.storage.session` charges every array element as a value
 * of its own, about 32 bytes per byte.
 */
export function toStored(value: unknown): unknown {
  return mapBinaryDeep(value, (bytes, kind) => ({ __gleamStored: kind, base64: bytesToBase64(bytes) }) satisfies StoredBinary);
}

export function fromStored(value: unknown): unknown {
  if (isStoredBinary(value)) {
    const bytes = base64ToBytes(value.base64);
    return value.__gleamStored === "ArrayBuffer" ? bytes.buffer : bytes;
  }
  if (Array.isArray(value)) return value.map(fromStored);
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fromStored(entry)]));
  return value;
}

const STORED_VALUE_BYTES = 32;

/**
 * `string`'s length once encoded as UTF-8, counted without encoding it.
 * A lone surrogate counts as the 3-byte U+FFFD it is replaced with.
 */
export function utf8ByteLength(string: string): number {
  let bytes = 0;
  for (let i = 0; i < string.length; i += 1) {
    const code = string.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < string.length) {
      const next = string.charCodeAt(i + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Roughly what `chrome.storage.session` charges for `value`: it counts the
 * memory of the stored value tree, a fixed cost per value plus each
 * string's (and key's) UTF-8 length, since Chrome stores strings as UTF-8.
 */
export function storedSize(value: unknown): number {
  if (typeof value === "string") return STORED_VALUE_BYTES + utf8ByteLength(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + storedSize(entry), STORED_VALUE_BYTES);
  if (isPlainRecord(value)) {
    return Object.entries(value).reduce<number>(
      (sum, [key, entry]) => sum + utf8ByteLength(key) + storedSize(entry),
      STORED_VALUE_BYTES,
    );
  }
  return STORED_VALUE_BYTES;
}

/*
 * `chrome.storage.session` holds 10 MiB. Pending requests may use 4 MiB of
 * it and one site 2 MiB, so one site can't fill it, and the outcomes and
 * device payloads written onto records before they are dropped still fit.
 */
export const PENDING_BYTES_LIMIT = 4 * 1024 * 1024;
export const PENDING_BYTES_PER_ORIGIN = 2 * 1024 * 1024;
