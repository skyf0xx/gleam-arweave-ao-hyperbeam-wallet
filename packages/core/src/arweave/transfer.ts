import { clientForGateway } from "./client";
import {
  applyTransactionSignature,
  buildUnsignedTransaction,
  postTransaction,
  signTransactionWithJwk,
  type ArweaveTransactionJson,
} from "./transaction";
import type { JWKInterface } from "../models/wallet";
import type { Winston } from "../models/balance";

/**
 * This module's public functions accept an already-decrypted
 * `JWKInterface` rather than a password or wallet id — they never
 * decrypt anything themselves, and never use `core/vault`'s envelope, since key
 * material is never persisted anywhere (see `wallet-lifecycle.ts`). This
 * keeps `core/arweave` agnostic about how the caller obtained signing
 * material. A hardware wallet uses `prepareTransfer`/`finishTransfer`
 * with a signature from the device instead.
 *
 * No `fetchImpl` injection point here (unlike `balance.ts`/`graphql.ts`):
 * `arweave-js`'s internal `Api` class always calls the ambient `fetch`
 * directly with no override hook, so tests mock `globalThis.fetch`
 * instead.
 */
export interface FeeQuote {
  fee: Winston;
}

/**
 * Reads a fee quote via the gateway's `price` endpoint. Pure network read,
 * no signing.
 *
 * `recipient` is optional, but omitting it underquotes: the gateway adds
 * a new-wallet fee once a target is known and isn't yet in the wallet
 * list, so a recipient-less quote can be lower than the real one.
 *
 * `byteSize` defaults to 0 (a plain AR value transfer with no data). A
 * caller quoting a data transaction (e.g. a dApp's `sign`/`dispatch`
 * request with no `reward` of its own) must pass the actual payload size —
 * arweave-js prices a transaction by its real `data.byteLength` when it
 * signs, so a 0-byte quote for a non-empty payload underquotes the fee
 * that will actually be charged.
 */
export async function estimateFee(gatewayUrl: string, recipient?: string, byteSize = 0): Promise<FeeQuote> {
  const client = clientForGateway(gatewayUrl);
  const fee = await client.transactions.getPrice(byteSize, recipient);
  return { fee };
}

export interface SubmittedTransfer {
  txId: string;
}

/**
 * Builds the unsigned AR value transfer `ownerB64Url` will sign. Fetches
 * the anchor and the recipient-aware price from the gateway.
 */
export async function prepareTransfer(
  gatewayUrl: string,
  ownerB64Url: string,
  recipient: string,
  amount: Winston,
): Promise<ArweaveTransactionJson> {
  // arweave-js decodes `target` with strict base64 and would otherwise
  // throw a bare "Invalid character" DOMException.
  if (!/^[A-Za-z0-9_-]{43}$/.test(recipient)) {
    throw new Error(`Transfer recipient must be an Arweave address (43 base64url characters), got "${recipient}".`);
  }
  return buildUnsignedTransaction(gatewayUrl, ownerB64Url, { target: recipient, quantity: amount });
}

/** Applies `expectedOwner`'s signature to a `prepareTransfer` result and posts it. */
export async function finishTransfer(
  gatewayUrl: string,
  unsigned: ArweaveTransactionJson,
  signature: Uint8Array,
  expectedOwner: string,
): Promise<SubmittedTransfer> {
  const { id, transaction } = await applyTransactionSignature(unsigned, signature, expectedOwner);
  const response = await postTransaction(gatewayUrl, transaction);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Failed to submit transfer to ${gatewayUrl} (HTTP ${response.status}: ${response.statusText}).`,
    );
  }
  return { txId: id };
}

/** Builds, signs with the keyfile, and posts an AR value-transfer transaction. */
export async function submitTransfer(
  gatewayUrl: string,
  jwk: JWKInterface,
  recipient: string,
  amount: Winston,
): Promise<SubmittedTransfer> {
  const unsigned = await prepareTransfer(gatewayUrl, jwk.n, recipient, amount);
  return finishTransfer(gatewayUrl, unsigned, await signTransactionWithJwk(unsigned, jwk), jwk.n);
}
