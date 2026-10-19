import { prepareTransfer } from "../arweave/transfer";
import type { ArweaveTransactionJson } from "../arweave/transaction";
import type { UploadTag } from "../models/upload";

/**
 * Tokens on `arweave-scheduler@1.0` (fungible tokens and collectibles
 * alike) read their messages from Arweave L1, so a transfer is a plain
 * L1 transaction to the token process rather than an ANS-104 item posted
 * to the MU. It moves no AR; the transfer is in the tags, whose
 * lowercase names are what that scheduler matches. The sender pays the
 * network reward.
 */
const ADDRESS = /^[A-Za-z0-9_-]{43}$/;
const ATOMIC = /^[1-9]\d*$/;

export function l1TransferTags(recipient: string, quantity: string): UploadTag[] {
  return [
    { name: "action", value: "transfer" },
    { name: "recipient", value: recipient },
    { name: "quantity", value: quantity },
  ];
}

/** The unsigned transaction that moves `quantity` atomic units of `processId` from `ownerB64Url` to `recipient`. */
export async function prepareL1TokenTransfer(
  gatewayUrl: string,
  ownerB64Url: string,
  processId: string,
  recipient: string,
  quantity: string,
): Promise<ArweaveTransactionJson> {
  if (!ADDRESS.test(processId)) {
    throw new Error(`Token process must be an Arweave id (43 base64url characters), got "${processId}".`);
  }
  if (!ADDRESS.test(recipient)) {
    throw new Error(`Recipient must be an Arweave address (43 base64url characters), got "${recipient}".`);
  }
  if (!ATOMIC.test(quantity)) {
    throw new Error(`Transfer quantity must be a positive whole number of the token's smallest unit, got "${quantity}".`);
  }
  return prepareTransfer(gatewayUrl, ownerB64Url, processId, "0", l1TransferTags(recipient, quantity));
}

/**
 * The process, recipient and quantity of a transaction shaped exactly
 * like `prepareL1TokenTransfer`'s output, or null. `tags` are plain text.
 */
export function readL1TokenTransfer(transaction: {
  target: string;
  quantity: string;
  data_size: string;
  tags: UploadTag[];
}): { processId: string; recipient: string; quantity: string } | null {
  const [action, recipient, quantity, ...rest] = transaction.tags;
  if (
    !ADDRESS.test(transaction.target) ||
    (transaction.quantity || "0") !== "0" ||
    transaction.data_size !== "0" ||
    rest.length > 0 ||
    action?.name !== "action" ||
    action.value !== "transfer" ||
    recipient?.name !== "recipient" ||
    !ADDRESS.test(recipient.value) ||
    quantity?.name !== "quantity" ||
    !ATOMIC.test(quantity.value)
  ) {
    return null;
  }
  return { processId: transaction.target, recipient: recipient.value, quantity: quantity.value };
}
