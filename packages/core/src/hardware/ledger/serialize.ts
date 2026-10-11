import type { ArweaveTransactionJson } from "../../arweave/transaction";
import { base64UrlToBytes } from "../../vault/base64";
import { LedgerError } from "./errors";

type Bytes = Uint8Array<ArrayBuffer>;

/** Bytes per SIGN / SIGN_DATA_ITEM chunk after the first, as permawebOS sends them. */
export const LEDGER_CHUNK_SIZE = 200;

const encoder = new TextEncoder();

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function u16(value: number, field: string): Bytes {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new LedgerError("payload-too-large", `This transaction's ${field} is too large for a Ledger.`);
  }
  return new Uint8Array([value >> 8, value & 0xff]);
}

function withLength(bytes: Uint8Array, field: string): Bytes {
  return concatBytes(u16(bytes.byteLength, field), bytes);
}

/**
 * The transaction header the Arweave Ledger app parses
 * (`app/src/parser_impl.c`), laid out as Zondax's
 * `ArweaveApp.encodeTx` writes it: every field is a big-endian u16
 * length followed by its bytes; numbers (format, quantity, reward,
 * data_size) are their ASCII decimal strings, ids and keys are decoded
 * from base64url, and the tag list is a u16 count followed by
 * length-prefixed name/value pairs. `data` itself is never sent; the
 * device signs over `data_root`.
 */
export function encodeTransactionForLedger(tx: ArweaveTransactionJson): Bytes {
  const tags = tx.tags.flatMap((tag) => [
    withLength(base64UrlToBytes(tag.name), "tag name"),
    withLength(base64UrlToBytes(tag.value), "tag value"),
  ]);
  return concatBytes(
    withLength(encoder.encode(String(tx.format)), "format"),
    withLength(base64UrlToBytes(tx.owner), "owner"),
    withLength(base64UrlToBytes(tx.target), "target"),
    withLength(encoder.encode(String(tx.quantity)), "quantity"),
    withLength(encoder.encode(String(tx.reward)), "reward"),
    withLength(base64UrlToBytes(tx.last_tx), "last_tx"),
    u16(tx.tags.length, "tag count"),
    ...tags,
    withLength(encoder.encode(String(tx.data_size)), "data_size"),
    withLength(base64UrlToBytes(tx.data_root), "data_root"),
  );
}

/**
 * `first` (sent with P1 = init, which the device discards) followed by
 * `payload` in 200-byte pieces. Always yields at least one piece after
 * `first`, so the final P1 = last command is always sent.
 */
export function ledgerChunks(first: Uint8Array, payload: Uint8Array): Bytes[] {
  const chunks: Bytes[] = [Uint8Array.from(first)];
  for (let offset = 0; offset < payload.byteLength || offset === 0; offset += LEDGER_CHUNK_SIZE) {
    chunks.push(Uint8Array.from(payload.subarray(offset, offset + LEDGER_CHUNK_SIZE)));
  }
  return chunks;
}
