import type { UploadTag } from "./upload";

/**
 * The signing/crypto provider-surface methods' request/response shapes.
 * Modeled here, in `core/models`, following `transfer.ts`/`upload.ts`'s
 * precedent: the request/response pairing lives in `core` so both
 * `messaging` and the layers that actually execute these operations can
 * share one definition.
 *
 * Every operation resolves its signing key via the existing
 * unlocked-session cache (`getCachedKey(walletId)` in
 * `apps/extension/src/handlers/key-session.ts`) — none of these request
 * shapes carries a password field.
 *
 * Approval routing and the actual cryptographic execution
 * (`arweave-js`/`@dha-team/arbundles`) are later layers' job — this
 * layer only pins the wire shape.
 */

/**
 * A dApp's transaction, ready for `arweave-js`'s `createTransaction`. `data`
 * is standard base64 and `tags` are plain UTF-8 text; arweave-js base64url-
 * encodes the tags again when it builds the transaction. `reward` and
 * `last_tx` are fetched from the gateway when absent.
 */
export interface SignTransactionInput {
  data?: string;
  target?: string;
  quantity?: string;
  tags?: UploadTag[];
  reward?: string;
  last_tx?: string;
}

export interface SignRequest {
  walletId: string;
  transaction: SignTransactionInput;
  options?: Record<string, unknown>;
}

/**
 * A signed transaction as arweave-js's `Transaction.toJSON()` shows it,
 * without `data`: the dApp already holds the data, and arweave-js's
 * `transactions.sign` copies only `id`, `owner`, `reward`, `tags` and
 * `signature` back onto its own transaction. `tags` are base64url-encoded,
 * the way arweave-js stores them.
 */
export interface SignedTransaction {
  format: number;
  id: string;
  last_tx: string;
  owner: string;
  tags: UploadTag[];
  target: string;
  quantity: string;
  data_size: string;
  data_root: string;
  reward: string;
  signature: string;
}

export type SignResult = SignedTransaction;

/**
 * `dispatch()` request/response shapes, matching Wander's convention: a
 * transaction-shaped `dispatch()` call resolves to `{ id, type: "BASE" }`
 * (posted directly to a gateway) or `{ id, type: "BUNDLED" }` (wrapped as
 * an ANS-104 DataItem and submitted to a bundler). `type` is optional
 * because some dApp callers only inspect `id`.
 */
export interface DispatchRequest {
  walletId: string;
  transaction: SignTransactionInput;
}

export interface DispatchResult {
  id: string;
  type?: "BASE" | "BUNDLED";
}

/** An ANS-104 data item to sign. `data` is standard base64; tags are plain text. */
export interface DataItemInput {
  data: string;
  tags?: UploadTag[];
  target?: string;
  anchor?: string;
}

export interface SignDataItemRequest {
  walletId: string;
  dataItem: DataItemInput;
}

/** The raw signed ANS-104 item, as Wander resolves it. */
export type SignDataItemResult = ArrayBuffer;

export interface BatchSignDataItemRequest {
  walletId: string;
  dataItems: DataItemInput[];
}

/** One raw signed item per input, in order. */
export type BatchSignDataItemResult = ArrayBuffer[];

/**
 * WebCrypto's own `RsaOaepParams`/`AesCtrParams`/`AesCbcParams`/
 * `AesGcmParams` shapes, re-declared here rather than imported: `core`
 * has zero `chrome.*`/DOM dependency, and this keeps the model
 * resolvable under a `lib.dom`-free tsconfig. Field names match
 * WebCrypto exactly so a real `crypto.subtle.encrypt(...)` call needs no
 * translation.
 */
export interface RsaOaepParams {
  name: "RSA-OAEP";
  label?: ArrayBuffer;
}

export interface AesCtrParams {
  name: "AES-CTR";
  counter: ArrayBuffer;
  length: number;
}

export interface AesCbcParams {
  name: "AES-CBC";
  iv: ArrayBuffer;
}

export interface AesGcmParams {
  name: "AES-GCM";
  iv: ArrayBuffer;
  additionalData?: ArrayBuffer;
  tagLength?: number;
}

export type EncryptAlgorithm = RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams;

export interface EncryptRequest {
  walletId: string;
  /** Base64-encoded plaintext bytes — raw `ArrayBuffer` doesn't survive the messaging boundary intact. */
  data: string;
  algorithm: EncryptAlgorithm;
}

export interface EncryptResult {
  /** Base64-encoded ciphertext bytes. */
  data: string;
}

export interface DecryptRequest {
  walletId: string;
  /** Base64-encoded ciphertext bytes. */
  data: string;
  algorithm: EncryptAlgorithm;
}

export interface DecryptResult {
  /** Base64-encoded plaintext bytes. */
  data: string;
}

/**
 * `signature()`: ArConnect-deprecated (superseded by `sign`/`signMessage`/
 * `signDataItem`), kept because some existing dApp integrations still
 * call it. Produces a raw RSA-PSS signature over arbitrary data —
 * narrower than `signMessage` (which additionally supports
 * `hashAlgorithm`).
 */
export interface SignatureRequest {
  walletId: string;
  /** Base64-encoded data to sign. */
  data: string;
  options?: Record<string, unknown>;
}

export interface SignatureResult {
  /** Base64-encoded raw signature bytes. */
  signature: string;
}

/**
 * `signMessage`/`privateHash` both accept an `ArrayBuffer` directly per
 * Wander's convention (not a base64 string like `signature()`'s older
 * shape) — tagged as `TaggedArrayBuffer` at the wire-envelope layer since
 * raw `ArrayBuffer` doesn't survive `@webext-core/messaging`'s envelope
 * as-is; this model only pins the logical shape both sides agree on.
 */
export interface SignMessageRequest {
  walletId: string;
  data: ArrayBuffer;
  options?: { hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512" };
}

export interface SignMessageResult {
  signature: ArrayBuffer;
}

export interface PrivateHashRequest {
  walletId: string;
  data: ArrayBuffer;
  options?: { hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512" };
}

export interface PrivateHashResult {
  hash: ArrayBuffer;
}

export interface VerifyMessageRequest {
  publicKey: string;
  data: ArrayBuffer;
  signature: ArrayBuffer;
  options?: { hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512" };
}

export interface VerifyMessageResult {
  valid: boolean;
}
