import type { Signer } from "../vault/signer";
import type { UploadTag } from "../models/upload";
import { base64UrlToBytes, bytesToBase64Url } from "../vault/base64";
import { clientForGateway } from "./client";
import { sha256, signRsaPss, verifyRsaPss } from "./rsa-pss";

/**
 * Format-2 Arweave transactions split into build, sign and apply, so a
 * keyfile and a hardware device sign the same unsigned transaction.
 * arweave-js still builds the transaction (anchor, price and data_root)
 * and posts it; only the signing step moves out.
 */

/**
 * arweave-js's `Transaction.toJSON()`, in the same key order, so
 * `JSON.stringify` of it is what Keystone expects. Tags and `data` are
 * base64url. Unsigned, `id` and `signature` are empty.
 */
export interface ArweaveTransactionJson {
  format: number;
  id: string;
  last_tx: string;
  owner: string;
  tags: UploadTag[];
  target: string;
  quantity: string;
  data: string;
  data_size: string;
  data_root: string;
  reward: string;
  signature: string;
}

/**
 * The attributes handed to arweave-js's `createTransaction`. Leaving
 * `reward` or `last_tx` out makes it fetch them from the gateway; leaving
 * `data` out requires `target` and `quantity`.
 */
export interface TransactionAttributes {
  data?: Uint8Array;
  target?: string;
  quantity?: string;
  reward?: string;
  last_tx?: string;
}

export interface SignedArweaveTransaction {
  id: string;
  transaction: ArweaveTransactionJson;
}

type Bytes = Uint8Array<ArrayBuffer>;
type Transaction = ReturnType<ReturnType<typeof clientForGateway>["transactions"]["fromRaw"]>;

const SIGNATURE_LENGTH = 512;

/** For decoding and posting only; arweave-js's `fromRaw` never touches the network. */
let offlineClient: ReturnType<typeof clientForGateway> | undefined;
function fromJson(json: ArweaveTransactionJson): Transaction {
  offlineClient ??= clientForGateway("https://arweave.net");
  return offlineClient.transactions.fromRaw({ ...json, tags: json.tags.map((tag) => ({ ...tag })) });
}

function toJson(transaction: Transaction): ArweaveTransactionJson {
  return {
    format: transaction.format,
    id: transaction.id,
    last_tx: transaction.last_tx,
    owner: transaction.owner,
    tags: transaction.tags.map((tag) => ({ name: tag.name, value: tag.value })),
    target: transaction.target,
    quantity: transaction.quantity,
    data: bytesToBase64Url(transaction.data),
    data_size: transaction.data_size,
    data_root: transaction.data_root,
    reward: transaction.reward,
    signature: transaction.signature,
  };
}

/**
 * Builds an unsigned format-2 transaction owned by `ownerB64Url`. Needs no
 * key: arweave-js fills `owner` from the attribute. `gatewayUrl` serves
 * the anchor and price fetches when `attributes` leaves them out. Tags
 * are plain text; they are stored base64url.
 */
export async function buildUnsignedTransaction(
  gatewayUrl: string,
  ownerB64Url: string,
  attributes: TransactionAttributes,
  tags: UploadTag[] = [],
): Promise<ArweaveTransactionJson> {
  const client = clientForGateway(gatewayUrl);
  const transaction = await client.createTransaction({ ...attributes, owner: ownerB64Url });
  for (const tag of tags) {
    transaction.addTag(tag.name, tag.value);
  }
  return toJson(transaction);
}

/**
 * The deep hash a signer signs, recomputed from the transaction's fields.
 * `data_root` is recomputed from `data` too, so a header that doesn't
 * describe its own data never gets a signature.
 */
export async function transactionSignatureData(unsigned: ArweaveTransactionJson): Promise<Bytes> {
  if (unsigned.format !== 2) {
    throw new Error(`Only format 2 transactions can be signed, got format ${unsigned.format}.`);
  }
  const transaction = fromJson({ ...unsigned, data_root: "" });
  await transaction.prepareChunks(transaction.data);
  if (transaction.data_root !== unsigned.data_root || String(transaction.data.byteLength) !== unsigned.data_size) {
    throw new Error("The transaction's data_root or data_size doesn't match its data.");
  }
  return new Uint8Array(await transaction.getSignatureData());
}

function sameOwner(a: string, b: string): boolean {
  try {
    return bytesToBase64Url(base64UrlToBytes(a)) === bytesToBase64Url(base64UrlToBytes(b));
  } catch {
    return false;
  }
}

/**
 * True only when `signature` is a valid RSA-PSS signature by
 * `ownerB64Url` over this transaction's deep hash, and the transaction
 * names that same owner.
 */
export async function verifyTransactionSignature(
  unsigned: ArweaveTransactionJson,
  signature: Uint8Array,
  ownerB64Url: string,
): Promise<boolean> {
  if (signature.byteLength !== SIGNATURE_LENGTH || !sameOwner(unsigned.owner, ownerB64Url)) return false;
  let message: Bytes;
  try {
    message = await transactionSignatureData(unsigned);
  } catch {
    return false;
  }
  return verifyRsaPss(ownerB64Url, message, new Uint8Array(signature));
}

/**
 * Sets `id` and `signature` after checking that the transaction names
 * `expectedOwner` (the wallet's stored public key) and the signature
 * verifies against it.
 */
export async function applyTransactionSignature(
  unsigned: ArweaveTransactionJson,
  signature: Uint8Array,
  expectedOwner: string,
): Promise<SignedArweaveTransaction> {
  if (!(await verifyTransactionSignature(unsigned, signature, expectedOwner))) {
    throw new Error("The signature doesn't match this transaction or its owner.");
  }
  const id = bytesToBase64Url(await sha256(new Uint8Array(signature)));
  return { id, transaction: { ...unsigned, id, signature: bytesToBase64Url(signature) } };
}

/** Signs an unsigned transaction's deep hash with a keyfile. Returns the raw 512-byte signature. */
export async function signTransactionWithSigner(unsigned: ArweaveTransactionJson, signer: Signer): Promise<Bytes> {
  if (!sameOwner(unsigned.owner, signer.owner)) {
    throw new Error("This transaction names a different owner than the signing key.");
  }
  return signRsaPss(signer, await transactionSignatureData(unsigned));
}

/**
 * Posts a signed transaction through arweave-js, which uploads it in
 * chunks when its data is large. Returns the gateway's status for the
 * caller to judge.
 */
export async function postTransaction(gatewayUrl: string, signed: ArweaveTransactionJson): Promise<{ status: number; statusText: string }> {
  const client = clientForGateway(gatewayUrl);
  const response = await client.transactions.post(fromJson(signed));
  return { status: response.status, statusText: response.statusText };
}
