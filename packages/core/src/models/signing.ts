import type { Tag } from "./tag";

/**
 * The signing/crypto provider-surface methods' request/response shapes.
 * Modeled here, in `core/models`, following `transfer.ts`'s
 * precedent: the request/response pairing lives in `core` so both
 * `messaging` and the layers that actually execute these operations can
 * share one definition.
 *
 * Every operation resolves its signer from the unlocked session
 * (`getSigner(walletId)` in
 * `packages/runtime/src/handlers/key-session.ts`) — none of these request
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
  tags?: Tag[];
  reward?: string;
  last_tx?: string;
}

export interface SignRequest {
  walletId: string;
  transaction: SignTransactionInput;
  options?: Record<string, unknown>;
}

/**
 * A signed transaction as arweave-js's `Transaction.toJSON()` shows it.
 * `data` is included even though arweave-js's `transactions.sign` ignores
 * it: some dApps POST the result straight to `/tx`, and the node rejects
 * a transaction JSON with no `data` key. `tags` and `data` are base64url.
 */
export interface SignedTransaction {
  format: number;
  id: string;
  last_tx: string;
  owner: string;
  tags: Tag[];
  target: string;
  quantity: string;
  data: string;
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
  tags?: Tag[];
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
 * WebCrypto's `RsaOaepParams`, re-declared here rather than imported:
 * `core` has zero `chrome.*`/DOM dependency, and this keeps the model
 * resolvable under a `lib.dom`-free tsconfig. Field names match WebCrypto
 * exactly so a real `crypto.subtle.encrypt(...)` call needs no
 * translation.
 */
export interface RsaOaepParams {
  name: "RSA-OAEP";
  label?: ArrayBuffer;
}

/**
 * RSA-OAEP only. Wander's type also lists the AES params, but it runs
 * them against the wallet's RSA key, where WebCrypto always rejects them.
 */
export type EncryptAlgorithm = RsaOaepParams;

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
 * `signMessage` accepts an `ArrayBuffer` directly per
 * Wander's convention — tagged as `TaggedArrayBuffer` at the wire-envelope layer since
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

export interface VerifyMessageRequest {
  publicKey: string;
  data: ArrayBuffer;
  signature: ArrayBuffer;
  options?: { hashAlgorithm?: "SHA-256" | "SHA-384" | "SHA-512" };
}

export interface VerifyMessageResult {
  valid: boolean;
}
