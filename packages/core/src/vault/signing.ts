import type { Signer } from "./signer";
import type {
  SignTransactionInput,
  SignedTransaction,
  DataItemInput,
  DispatchResult,
} from "../models/signing";
import { postDataItemToBundler } from "../arweave/bundler";
import {
  applyTransactionSignature,
  buildUnsignedTransaction,
  broadcastTransaction,
  signTransactionWithSigner,
  verifyTransactionSignature,
  type ArweaveTransactionJson,
} from "../arweave/transaction";
import {
  applyDataItemSignature,
  buildUnsignedDataItem,
  signDataItemWithSigner,
  verifyDataItemSignature,
} from "../arweave/data-item";
import { base64ToBytes } from "./base64";
import { signMessage, verifyMessage } from "./message-signing";

/**
 * `core/vault`'s share of the provider-signing-crypto surface: the actual
 * cryptographic operations behind `sign`/`dispatch`/`signDataItem`/
 * `batchSignDataItem`. Every function here accepts an unlocked wallet's
 * `Signer` or only the owner's public key, and never touches
 * `core/vault`'s envelope or storage; resolving the signer from the
 * unlocked session (`getSigner(walletId)`) is the dispatch layer's job.
 *
 * Each operation comes in three parts so keyfile and hardware wallets
 * share one pipeline: `prepare*` builds the unsigned payload from the
 * owner alone, the key signs its deep hash (`signPayloadWithSigner` here, or
 * a device), and `finish*` applies the signature, checks it, and
 * submits. The keyfile entry points (`signTransaction`,
 * `dispatchTransaction`, `signDataItem`, `batchSignDataItem`) are those
 * three steps run back to back.
 */

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * What a signer signs: an unsigned format-2 transaction, the raw bytes of
 * an unsigned ANS-104 item, or a `signMessage` message (SHA-256 only,
 * the one hash a Keystone signs messages with).
 */
export type UnsignedPayload =
  | { kind: "transaction"; transaction: ArweaveTransactionJson }
  | { kind: "dataItem"; raw: Bytes }
  | { kind: "message"; data: Bytes };

export type SignedPayload =
  | { kind: "transaction"; id: string; transaction: ArweaveTransactionJson }
  | { kind: "dataItem"; id: string; raw: Bytes };

/**
 * True only when `signature` is a valid RSA-PSS (SHA-256, salt 32)
 * signature by `ownerB64Url` over the payload's deep hash, which is
 * recomputed here, and the payload names that same owner. A message
 * must pass `verifyMessage`.
 */
export async function verifyDeviceSignature(
  unsigned: UnsignedPayload,
  signature: Uint8Array,
  ownerB64Url: string,
): Promise<boolean> {
  switch (unsigned.kind) {
    case "transaction":
      return verifyTransactionSignature(unsigned.transaction, signature, ownerB64Url);
    case "dataItem":
      return verifyDataItemSignature(unsigned.raw, signature, ownerB64Url);
    case "message":
      return verifyMessage(ownerB64Url, unsigned.data.slice().buffer, new Uint8Array(signature).buffer, "SHA-256");
  }
}

/**
 * Applies a raw 512-byte signature. Throws unless the payload names
 * `expectedOwner` (the wallet's stored public key) and the signature
 * verifies against it.
 */
export async function applySignature(
  unsigned: UnsignedPayload,
  signature: Uint8Array,
  expectedOwner: string,
): Promise<SignedPayload> {
  if (unsigned.kind === "transaction") {
    const { id, transaction } = await applyTransactionSignature(unsigned.transaction, signature, expectedOwner);
    return { kind: "transaction", id, transaction };
  }
  if (unsigned.kind === "message") throw new Error("A message signature is returned as is, not applied to a payload.");
  const { id, raw } = await applyDataItemSignature(unsigned.raw, signature, expectedOwner);
  return { kind: "dataItem", id, raw };
}

/** Signs the payload's deep hash with a keyfile. Returns the raw 512-byte signature. */
export async function signPayloadWithSigner(unsigned: UnsignedPayload, signer: Signer): Promise<Bytes> {
  switch (unsigned.kind) {
    case "transaction":
      return signTransactionWithSigner(unsigned.transaction, signer);
    case "dataItem":
      return signDataItemWithSigner(unsigned.raw, signer);
    case "message":
      return new Uint8Array(await signMessage(signer, unsigned.data.slice().buffer, "SHA-256"));
  }
}

/** Threshold (bytes) above which `dispatch()` bundles rather than posts as a base AR tx. Below it, dispatch posts directly to the gateway as a `BASE` transaction. */
const DISPATCH_BUNDLE_THRESHOLD_BYTES = 100 * 1024;

/** Anything other than an empty or all-zero quantity moves AR, including malformed values arweave-js will reject. */
function transfersAr(quantity: string | undefined): boolean {
  return !/^0*$/.test(quantity?.trim() ?? "");
}

function transactionAttributes(input: SignTransactionInput, data: Uint8Array) {
  return {
    data,
    target: input.target ?? "",
    quantity: input.quantity ?? "0",
    reward: input.reward,
    last_tx: input.last_tx,
  };
}

function plainTags(tags: DataItemInput["tags"]) {
  return tags?.map((tag) => ({ name: tag.name, value: tag.value }));
}

/**
 * The dApp's transaction, unsigned. `gatewayUrl` is only used to fetch
 * `last_tx` and `reward` when the dApp left them out.
 */
export async function prepareSignTransaction(
  gatewayUrl: string,
  ownerB64Url: string,
  input: SignTransactionInput,
): Promise<ArweaveTransactionJson> {
  const data = input.data ? base64ToBytes(input.data) : new Uint8Array(0);
  return buildUnsignedTransaction(gatewayUrl, ownerB64Url, transactionAttributes(input, data), input.tags);
}

/** Applies the signature to a `prepareSignTransaction` result, without posting it. */
export async function finishSignTransaction(
  unsigned: ArweaveTransactionJson,
  signature: Uint8Array,
  expectedOwner: string,
): Promise<SignedTransaction> {
  const { transaction } = await applyTransactionSignature(unsigned, signature, expectedOwner);
  return {
    format: transaction.format,
    id: transaction.id,
    last_tx: transaction.last_tx,
    owner: transaction.owner,
    tags: transaction.tags,
    target: transaction.target,
    quantity: transaction.quantity,
    data: transaction.data,
    data_size: transaction.data_size,
    data_root: transaction.data_root,
    reward: transaction.reward,
    signature: transaction.signature,
  };
}

/** Signs the dApp's transaction with a keyfile without posting it. */
export async function signTransaction(
  gatewayUrl: string,
  signer: Signer,
  input: SignTransactionInput,
): Promise<SignedTransaction> {
  const unsigned = await prepareSignTransaction(gatewayUrl, signer.owner, input);
  return finishSignTransaction(unsigned, await signTransactionWithSigner(unsigned, signer), signer.owner);
}

export interface DispatchOptions {
  /** `capabilitiesFor(method).dispatchViaBundler`. When false, every dispatch goes to the gateway on L1. */
  viaBundler: boolean;
}

/**
 * Builds what `dispatch` will sign. Payloads over
 * `DISPATCH_BUNDLE_THRESHOLD_BYTES` become an ANS-104 data item for the
 * bundler (`BUNDLED`) when the wallet can sign one for it; everything
 * else is a base transaction for the gateway (`BASE`).
 *
 * A data item has no `quantity` field, so bundling a transaction that
 * sends AR would store the data and quietly drop the transfer. Those
 * always go to the gateway as a base transaction, whatever their size.
 */
export async function prepareDispatch(
  gatewayUrl: string,
  ownerB64Url: string,
  input: SignTransactionInput,
  { viaBundler }: DispatchOptions,
): Promise<UnsignedPayload> {
  const payloadBytes = input.data ? base64ToBytes(input.data) : new Uint8Array(0);

  if (viaBundler && payloadBytes.byteLength > DISPATCH_BUNDLE_THRESHOLD_BYTES && !transfersAr(input.quantity)) {
    const raw = buildUnsignedDataItem(ownerB64Url, {
      data: payloadBytes,
      tags: plainTags(input.tags),
      target: input.target,
    });
    return { kind: "dataItem", raw };
  }

  const transaction = await buildUnsignedTransaction(
    gatewayUrl,
    ownerB64Url,
    transactionAttributes(input, payloadBytes),
    input.tags,
  );
  return { kind: "transaction", transaction };
}

/**
 * Applies the signature to a `prepareDispatch` payload and submits it.
 * Throws if the bundler or gateway rejects it, so the dApp never gets an
 * id for data that wasn't stored.
 */
export async function finishDispatch(
  gatewayUrl: string,
  bundlerUrl: string,
  unsigned: UnsignedPayload,
  signature: Uint8Array,
  expectedOwner: string,
): Promise<DispatchResult> {
  const signed = await applySignature(unsigned, signature, expectedOwner);
  if (signed.kind === "dataItem") {
    await postDataItemToBundler(bundlerUrl, signed.raw);
    return { id: signed.id, type: "BUNDLED" };
  }

  const response = await broadcastTransaction(gatewayUrl, signed.transaction);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to dispatch transaction to ${gatewayUrl} (HTTP ${response.status}: ${response.statusText}).`,
    );
  }
  return { id: signed.id, type: "BASE" };
}

/** Signs a transaction with a keyfile and submits it; see `prepareDispatch` for where it goes. */
export async function dispatchTransaction(
  gatewayUrl: string,
  bundlerUrl: string,
  signer: Signer,
  input: SignTransactionInput,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const unsigned = await prepareDispatch(gatewayUrl, signer.owner, input, options);
  return finishDispatch(gatewayUrl, bundlerUrl, unsigned, await signPayloadWithSigner(unsigned, signer), signer.owner);
}

/** The unsigned item for a dApp's `signDataItem`. `input.data` is standard base64 and tags are plain text. */
export function prepareDataItem(ownerB64Url: string, input: DataItemInput): Bytes {
  return buildUnsignedDataItem(ownerB64Url, {
    data: base64ToBytes(input.data),
    tags: plainTags(input.tags),
    target: input.target,
    anchor: input.anchor,
  });
}

/** Applies the signature to a `prepareDataItem` result and returns the raw signed item. */
export async function finishDataItem(unsigned: Uint8Array, signature: Uint8Array, expectedOwner: string): Promise<Bytes> {
  return (await applyDataItemSignature(unsigned, signature, expectedOwner)).raw;
}

/** Signs one ANS-104 data item with a keyfile and returns its raw bytes. */
export async function signDataItem(signer: Signer, input: DataItemInput): Promise<Bytes> {
  const unsigned = prepareDataItem(signer.owner, input);
  return finishDataItem(unsigned, await signDataItemWithSigner(unsigned, signer), signer.owner);
}

export function prepareDataItems(ownerB64Url: string, inputs: DataItemInput[]): Bytes[] {
  return inputs.map((input) => prepareDataItem(ownerB64Url, input));
}

/** One signature per unsigned item, in the same order. */
export async function finishDataItems(
  unsigned: Uint8Array[],
  signatures: Uint8Array[],
  expectedOwner: string,
): Promise<Bytes[]> {
  if (unsigned.length !== signatures.length) {
    throw new Error(`Expected ${unsigned.length} signatures, got ${signatures.length}.`);
  }
  const results: Bytes[] = [];
  for (const [index, item] of unsigned.entries()) {
    results.push(await finishDataItem(item, signatures[index]!, expectedOwner));
  }
  return results;
}

/** Signs each item in order with the same keyfile. */
export async function batchSignDataItem(signer: Signer, inputs: DataItemInput[]): Promise<Bytes[]> {
  const unsigned = prepareDataItems(signer.owner, inputs);
  const signatures: Bytes[] = [];
  for (const item of unsigned) {
    signatures.push(await signDataItemWithSigner(item, signer));
  }
  return finishDataItems(unsigned, signatures, signer.owner);
}
