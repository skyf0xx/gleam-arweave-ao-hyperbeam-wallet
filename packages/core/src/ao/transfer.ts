import type { JWKInterface } from "../models/wallet";

/**
 * An AO `Transfer` is a signed ANS-104 data item posted to the legacynet
 * Messenger Unit. The MU/CU routing here is independent of
 * `NetworkSettings.activePeerUrl`, which selects a HyperBEAM peer for
 * `ao/balance.ts`'s `~process@1.0` reads, an unrelated piece of
 * infrastructure.
 *
 * Tags follow the `ao.TN.1` message protocol
 * (`Data-Protocol`/`Variant`/`Type`/`Action`/`Recipient`/`Quantity`,
 * capitalized) that AO token processes' `Transfer` handler matches on.
 *
 * The data item is built, signed, and posted here with plain `Uint8Array`s
 * and WebCrypto rather than through `@permaweb/aoconnect`: aoconnect's
 * browser build re-verifies every signed item through its bundled
 * arbundles `ArweaveSigner.verify`, which hands the owner's raw bytes to
 * `crypto.subtle.importKey("jwk", { n: <Uint8Array> })` instead of a
 * base64url string, so Chrome rejects every signature ("The JWK member 'n'
 * could not be base64url decoded"). Owning the ~100 lines of ANS-104
 * encoding also keeps Node polyfills (`Buffer`, `crypto`) out of this path.
 */
export const AO_LEGACY_MU_URL = "https://mu.ao-testnet.xyz";

export interface SubmittedAoTransfer {
  /** The data item id — base64url SHA-256 of its signature — once the Messenger Unit accepts it. */
  messageId: string;
}

/**
 * AO token transfers have no `arweave/transfer.ts`-style fee quote to
 * estimate: an AR value-transfer pays a miner fee taken from the sender's
 * own balance, computed up front via the gateway's `price` endpoint. An AO
 * `Transfer` message posts to the token process for the process to execute
 * — the token process (not the sender) bears its own compute cost, and
 * nothing in AO's message protocol quotes a sender-side fee before
 * posting. Rather than inventing a fabricated `0` or a plausible-looking
 * placeholder, this is made explicit: there is no fee quote for this
 * path, and callers should carry `TransferDraft.fee` as `null` for every
 * AO transfer, matching its `Winston | null` shape.
 */
export const AO_TRANSFER_HAS_NO_FEE = true;

interface Tag {
  name: string;
  value: string;
}

/** ANS-104 signature type 1: Arweave RSA-PSS 4096. */
const SIGNATURE_TYPE = 1;
const SIGNATURE_LENGTH = 512;
const OWNER_LENGTH = 512;
const MAX_TAG_BYTES = 4096;

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

function base64UrlToBytes(value: string): Bytes {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Bytes[]): Bytes {
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
function encodeTags(tags: Tag[]): Bytes {
  if (tags.length === 0) return new Uint8Array();
  const out = avroLong(tags.length);
  for (const { name, value } of tags) {
    for (const field of [encoder.encode(name), encoder.encode(value)]) {
      out.push(...avroLong(field.byteLength), ...field);
    }
  }
  out.push(...avroLong(0));
  if (out.length > MAX_TAG_BYTES) {
    throw new Error(`AO message tags encode to ${out.length} bytes, over ANS-104's ${MAX_TAG_BYTES}-byte limit.`);
  }
  return new Uint8Array(out);
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

async function signRsaPss(jwk: JWKInterface, message: Bytes): Promise<Bytes> {
  const { kty, n, e, d, p, q, dp, dq, qi } = jwk;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty, n, e, d, p, q, dp, dq, qi, ext: true },
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, key, message));
}

/**
 * Builds and signs an ANS-104 data item with signature type 1 (Arweave
 * RSA-PSS), no anchor. Returns the raw item bytes and its id.
 */
export async function createSignedDataItem(
  jwk: JWKInterface,
  { data, target, tags }: { data: Bytes; target: string; tags: Tag[] },
): Promise<{ id: string; raw: Bytes }> {
  const owner = base64UrlToBytes(jwk.n);
  if (owner.byteLength !== OWNER_LENGTH) {
    throw new Error(`Expected a ${OWNER_LENGTH}-byte RSA modulus for the signing key, got ${owner.byteLength} bytes.`);
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(target)) {
    throw new Error(`AO message target must be a 32-byte Arweave id (43 base64url characters), got "${target}".`);
  }
  const targetBytes = base64UrlToBytes(target);
  const anchor = new Uint8Array();
  const tagBytes = encodeTags(tags);

  const signatureData = await deepHash([
    encoder.encode("dataitem"),
    encoder.encode("1"),
    encoder.encode(String(SIGNATURE_TYPE)),
    owner,
    targetBytes,
    anchor,
    tagBytes,
    data,
  ]);
  const signature = await signRsaPss(jwk, signatureData);
  if (signature.byteLength !== SIGNATURE_LENGTH) {
    throw new Error(`Expected a ${SIGNATURE_LENGTH}-byte RSA-PSS signature, got ${signature.byteLength} bytes.`);
  }

  const raw = concat(
    littleEndian(SIGNATURE_TYPE, 2),
    signature,
    owner,
    new Uint8Array([1]),
    targetBytes,
    new Uint8Array([0]),
    littleEndian(tags.length, 8),
    littleEndian(tagBytes.byteLength, 8),
    tagBytes,
    data,
  );
  const id = bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", signature)));
  return { id, raw };
}

/**
 * Builds, signs, and posts an AO `Transfer` message to `processId` via the
 * legacynet Messenger Unit. `amount` is an atomic-integer string in the
 * token's own smallest unit (matching `TokenBalance.quantity`'s shape) —
 * never a floating-point number. `processId` must be a valid 43-character
 * base64url Arweave id (32 raw bytes) — it becomes the data item's
 * `target`.
 *
 * What "submitted" means here: the MU has accepted and scheduled the
 * signed data item — not that the token process has executed the
 * `Transfer` handler yet, nor that the recipient's balance has updated.
 * Callers writing an optimistic activity entry from this result should
 * treat status as "message accepted by the MU", not "transfer confirmed".
 */
export async function submitTransfer(
  jwk: JWKInterface,
  processId: string,
  recipient: string,
  amount: string,
): Promise<SubmittedAoTransfer> {
  const { id, raw } = await createSignedDataItem(jwk, {
    // A tag-only message still carries a non-empty body, as other AO
    // wallets send it, rather than relying on the MU accepting empty data.
    data: encoder.encode(" "),
    target: processId,
    tags: [
      { name: "Data-Protocol", value: "ao" },
      { name: "Variant", value: "ao.TN.1" },
      { name: "Type", value: "Message" },
      { name: "Action", value: "Transfer" },
      { name: "Recipient", value: recipient },
      { name: "Quantity", value: amount },
      { name: "Content-Type", value: "text/plain" },
    ],
  });

  const response = await fetch(AO_LEGACY_MU_URL, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", accept: "application/json" },
    body: raw,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AO message submission to ${AO_LEGACY_MU_URL} failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }

  return { messageId: id };
}
