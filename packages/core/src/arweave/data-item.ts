import type { JWKInterface } from "../models/wallet";
import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";
import { sha256, signRsaPss, verifyRsaPss } from "./rsa-pss";

/**
 * ANS-104 data items with signature type 1 (Arweave RSA-PSS 4096), built
 * from plain `Uint8Array`s and WebCrypto. Every item Gleam signs (AO
 * sends, dApp `signDataItem`, bundled `dispatch`, uploads) goes through
 * here: build the unsigned bytes from the owner alone, sign the deep
 * hash wherever the key lives (keyfile in memory, or a hardware device),
 * then write the signature in.
 *
 * Not arbundles: its web build's `ArweaveSigner.verify` hands the owner's
 * raw bytes to `crypto.subtle.importKey("jwk", { n: <Uint8Array> })`,
 * which Chrome rejects, and it needs a full JWK just to build an item.
 * The encoding matches arbundles' `createData` byte for byte
 * (`data-item.arweave.test.ts`), including its anchor handling: a
 * string anchor is UTF-8 encoded and must be 32 bytes, and an absent
 * anchor leaves the presence byte at 0.
 */

export interface DataItemTag {
  name: string;
  value: string;
}

export interface DataItemFields {
  data: Uint8Array;
  /** Base64url Arweave id (32 bytes). Empty or absent means no target. */
  target?: string;
  /** 32 bytes once UTF-8 encoded. Empty or absent means no anchor. */
  anchor?: string;
  tags?: DataItemTag[];
}

export interface SignedDataItem {
  /** Base64url SHA-256 of the signature. */
  id: string;
  raw: Bytes;
}

type Bytes = Uint8Array<ArrayBuffer>;

const SIGNATURE_TYPE = 1;
const SIGNATURE_OFFSET = 2;
const SIGNATURE_LENGTH = 512;
const OWNER_OFFSET = SIGNATURE_OFFSET + SIGNATURE_LENGTH;
const OWNER_LENGTH = 512;
const TARGET_LENGTH = 32;
const ANCHOR_LENGTH = 32;
const MAX_TAG_BYTES = 4096;

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Unsigned little-endian integer of `width` bytes, as ANS-104's header fields are encoded. */
function littleEndian(value: number, width: number): Bytes {
  const out = new Uint8Array(width);
  let remaining = value;
  for (let i = 0; i < width; i += 1) {
    out[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return out;
}

function readLittleEndian(bytes: Uint8Array, offset: number, width: number): number {
  let value = 0;
  for (let i = width - 1; i >= 0; i -= 1) {
    value = value * 256 + bytes[offset + i]!;
  }
  return value;
}

/** Avro zigzag-varint `long`, the length prefix ANS-104's tag encoding uses. */
function avroLong(value: number): number[] {
  let zigzag = value * 2;
  const out: number[] = [];
  do {
    let byte = zigzag % 128;
    zigzag = Math.floor(zigzag / 128);
    if (zigzag > 0) byte |= 128;
    out.push(byte);
  } while (zigzag > 0);
  return out;
}

/** Avro array-of-`{name, value}`-bytes encoding of `tags`, per ANS-104. */
function encodeTags(tags: DataItemTag[]): Bytes {
  if (tags.length === 0) return new Uint8Array();
  const parts: Uint8Array[] = [new Uint8Array(avroLong(tags.length))];
  let size = parts[0]!.byteLength + 1;
  for (const { name, value } of tags) {
    for (const field of [encoder.encode(name), encoder.encode(value)]) {
      const prefix = new Uint8Array(avroLong(field.byteLength));
      size += prefix.byteLength + field.byteLength;
      if (size > MAX_TAG_BYTES) {
        throw new Error(`Data item tags encode to over ANS-104's ${MAX_TAG_BYTES}-byte limit.`);
      }
      parts.push(prefix, field);
    }
  }
  parts.push(new Uint8Array(avroLong(0)));
  return concat(...parts);
}

async function sha384(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-384", data));
}

/** Arweave's deep hash over a list of blobs (no nested lists — ANS-104 never needs them). */
async function deepHash(chunks: Bytes[]): Promise<Bytes> {
  let accumulator = await sha384(encoder.encode(`list${chunks.length}`));
  for (const chunk of chunks) {
    const blobHash = await sha384(concat(await sha384(encoder.encode(`blob${chunk.byteLength}`)), await sha384(chunk)));
    accumulator = await sha384(concat(accumulator, blobHash));
  }
  return accumulator;
}

function ownerBytes(ownerB64Url: string): Bytes {
  const owner = base64UrlToBytes(ownerB64Url);
  if (owner.byteLength !== OWNER_LENGTH) {
    throw new Error(`Expected a ${OWNER_LENGTH}-byte RSA modulus as the data item owner, got ${owner.byteLength} bytes.`);
  }
  return owner;
}

function targetBytes(target: string | undefined): Bytes | null {
  if (!target) return null;
  const bytes = /^[A-Za-z0-9_-]{43}$/.test(target) ? base64UrlToBytes(target) : new Uint8Array();
  if (bytes.byteLength !== TARGET_LENGTH) {
    throw new Error(`Data item target must be a 32-byte Arweave id (43 base64url characters), got "${target}".`);
  }
  return bytes;
}

function anchorBytes(anchor: string | undefined): Bytes | null {
  if (!anchor) return null;
  const bytes = encoder.encode(anchor);
  if (bytes.byteLength !== ANCHOR_LENGTH) {
    throw new Error(`Data item anchor must be ${ANCHOR_LENGTH} bytes, got ${bytes.byteLength}.`);
  }
  return bytes;
}

/**
 * The raw bytes of an unsigned item: the full ANS-104 layout with the
 * signature field zero-filled. This is what a device signs from.
 */
export function buildUnsignedDataItem(ownerB64Url: string, fields: DataItemFields): Bytes {
  const owner = ownerBytes(ownerB64Url);
  const target = targetBytes(fields.target);
  const anchor = anchorBytes(fields.anchor);
  const tags = fields.tags ?? [];
  const tagBytes = encodeTags(tags);
  return concat(
    littleEndian(SIGNATURE_TYPE, 2),
    new Uint8Array(SIGNATURE_LENGTH),
    owner,
    target ? concat(new Uint8Array([1]), target) : new Uint8Array([0]),
    anchor ? concat(new Uint8Array([1]), anchor) : new Uint8Array([0]),
    littleEndian(tags.length, 8),
    littleEndian(tagBytes.byteLength, 8),
    tagBytes,
    fields.data,
  );
}

interface DataItemParts {
  owner: Bytes;
  target: Bytes;
  anchor: Bytes;
  tags: Bytes;
  data: Bytes;
}

/** Splits a raw item into the fields its deep hash covers. Throws on anything that isn't a type-1 item. */
function parseDataItem(raw: Uint8Array): DataItemParts {
  const fail = (why: string): never => {
    throw new Error(`Not a valid ANS-104 data item: ${why}.`);
  };
  if (raw.byteLength < OWNER_OFFSET + OWNER_LENGTH + 2 + 16) fail("too short");
  if (readLittleEndian(raw, 0, 2) !== SIGNATURE_TYPE) fail("signature type is not Arweave RSA-PSS (1)");

  const slice = (start: number, end: number): Bytes => {
    if (end > raw.byteLength) fail("truncated");
    return raw.slice(start, end);
  };
  const presentField = (offset: number, length: number): [Bytes, number] => {
    const flag = raw[offset];
    if (flag === 0) return [new Uint8Array(), offset + 1];
    if (flag !== 1) fail("bad presence byte");
    return [slice(offset + 1, offset + 1 + length), offset + 1 + length];
  };

  const owner = slice(OWNER_OFFSET, OWNER_OFFSET + OWNER_LENGTH);
  const [target, anchorStart] = presentField(OWNER_OFFSET + OWNER_LENGTH, TARGET_LENGTH);
  const [anchor, tagsStart] = presentField(anchorStart, ANCHOR_LENGTH);
  const tagByteLength = readLittleEndian(slice(tagsStart, tagsStart + 16), 8, 8);
  if (tagByteLength > MAX_TAG_BYTES) fail("tags exceed 4096 bytes");
  const tags = slice(tagsStart + 16, tagsStart + 16 + tagByteLength);
  const data = raw.slice(tagsStart + 16 + tagByteLength);
  return { owner, target, anchor, tags, data };
}

/** The deep hash a signer signs, recomputed from the item's own bytes. */
export async function dataItemSignatureData(raw: Uint8Array): Promise<Bytes> {
  const { owner, target, anchor, tags, data } = parseDataItem(raw);
  return deepHash([
    encoder.encode("dataitem"),
    encoder.encode("1"),
    encoder.encode(String(SIGNATURE_TYPE)),
    owner,
    target,
    anchor,
    tags,
    data,
  ]);
}

function sameOwner(a: string, b: string): boolean {
  try {
    return bytesToBase64Url(base64UrlToBytes(a)) === bytesToBase64Url(base64UrlToBytes(b));
  } catch {
    return false;
  }
}

/** The item's owner as base64url, as stored on a wallet record. */
export function dataItemOwner(raw: Uint8Array): string {
  return bytesToBase64Url(parseDataItem(raw).owner);
}

/**
 * True only when `signature` is a valid RSA-PSS signature by
 * `ownerB64Url` over this item's deep hash, and the item names that same
 * owner.
 */
export async function verifyDataItemSignature(
  unsigned: Uint8Array,
  signature: Uint8Array,
  ownerB64Url: string,
): Promise<boolean> {
  if (signature.byteLength !== SIGNATURE_LENGTH) return false;
  let owner: string;
  let message: Bytes;
  try {
    owner = dataItemOwner(unsigned);
    message = await dataItemSignatureData(unsigned);
  } catch {
    return false;
  }
  if (!sameOwner(owner, ownerB64Url)) return false;
  return verifyRsaPss(ownerB64Url, message, new Uint8Array(signature));
}

/**
 * Writes `signature` into bytes 2..514 of the item after checking that
 * the item names `expectedOwner` (the wallet's stored public key) and
 * the signature verifies against it. Throws rather than return an item
 * signed by anyone else.
 */
export async function applyDataItemSignature(
  unsigned: Uint8Array,
  signature: Uint8Array,
  expectedOwner: string,
): Promise<SignedDataItem> {
  if (!(await verifyDataItemSignature(unsigned, signature, expectedOwner))) {
    throw new Error("The signature doesn't match this data item or its owner.");
  }
  const raw = new Uint8Array(unsigned);
  raw.set(signature, SIGNATURE_OFFSET);
  return { id: bytesToBase64Url(await sha256(new Uint8Array(signature))), raw };
}

/** Signs an unsigned item's deep hash with a keyfile. Returns the raw 512-byte signature. */
export async function signDataItemWithJwk(unsigned: Uint8Array, jwk: JWKInterface): Promise<Bytes> {
  if (!sameOwner(dataItemOwner(unsigned), jwk.n)) {
    throw new Error("This data item names a different owner than the signing key.");
  }
  const signature = await signRsaPss(jwk, await dataItemSignatureData(unsigned));
  if (signature.byteLength !== SIGNATURE_LENGTH) {
    throw new Error(`Expected a ${SIGNATURE_LENGTH}-byte RSA-PSS signature, got ${signature.byteLength} bytes.`);
  }
  return signature;
}

/** Build → sign with the keyfile → apply. */
export async function createSignedDataItem(jwk: JWKInterface, fields: DataItemFields): Promise<SignedDataItem> {
  const unsigned = buildUnsignedDataItem(jwk.n, fields);
  return applyDataItemSignature(unsigned, await signDataItemWithJwk(unsigned, jwk), jwk.n);
}
