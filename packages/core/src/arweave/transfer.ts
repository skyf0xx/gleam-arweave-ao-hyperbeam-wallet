import { clientForGateway } from "./client";
import {
  applyTransactionSignature,
  buildUnsignedTransaction,
  broadcastTransaction,
  type ArweaveTransactionJson,
} from "./transaction";
import type { Winston } from "../models/balance";
import type { Tag } from "../models/tag";
import { userErrorMessage } from "../models/user-errors";
import { isArweaveId } from "../models/arweave-id";

/**
 * Builds an AR transfer from the owner's public key (`prepareTransfer`)
 * and posts it once signed (`finishTransfer`). Keyfile and hardware
 * wallets sign between the two, after the caller has checked the built
 * transaction against what was approved, so nothing here holds a key.
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
 * Builds the unsigned, data-less transaction to `recipient` that
 * `ownerB64Url` will sign: an AR value transfer, or with `tags` a message
 * to a process that reads L1 (a collectible send). `reward` is the fee the
 * user approved, never a fresh quote: the gateway only supplies the anchor,
 * so it can't raise the fee after they saw it.
 */
export async function prepareTransfer(
  gatewayUrl: string,
  ownerB64Url: string,
  recipient: string,
  amount: Winston,
  reward: Winston,
  tags: Tag[] = [],
): Promise<ArweaveTransactionJson> {
  // arweave-js decodes `target` with strict base64 and would otherwise
  // throw a bare "Invalid character" DOMException.
  if (!isArweaveId(recipient)) {
    throw new Error(userErrorMessage("transferRecipientInvalid", { recipient }));
  }
  // The quantity is what gets signed, and the network only accepts a whole
  // number of Winston. A decimal, exponent or sign would build a transaction
  // that can never be mined; the UI checks its field, and this is the last
  // point every caller, the hardware path included, passes through.
  if (!/^\d+$/.test(amount)) {
    throw new Error(`A transfer amount must be a whole number of Winston, got "${amount}".`);
  }
  return buildUnsignedTransaction(gatewayUrl, ownerB64Url, { target: recipient, quantity: amount, reward }, tags);
}

/** Applies `expectedOwner`'s signature to a `prepareTransfer` result and posts it. */
export async function finishTransfer(
  gatewayUrl: string,
  unsigned: ArweaveTransactionJson,
  signature: Uint8Array,
  expectedOwner: string,
): Promise<SubmittedTransfer> {
  const { id, transaction } = await applyTransactionSignature(unsigned, signature, expectedOwner);
  const response = await broadcastTransaction(gatewayUrl, transaction);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      userErrorMessage("transferSubmitFailed", { gateway: gatewayUrl, status: response.status, statusText: response.statusText }),
    );
  }
  return { txId: id };
}
