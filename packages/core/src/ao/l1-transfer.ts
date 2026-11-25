import { getBalance } from "../arweave/balance";
import { estimateFee, prepareTransfer } from "../arweave/transfer";
import type { ArweaveTransactionJson } from "../arweave/transaction";
import type { Winston } from "../models/balance";
import type { Tag } from "../models/tag";
import { userErrorMessage } from "../models/user-errors";
import { ARWEAVE_ID } from "../models/arweave-id";

/**
 * Tokens on `arweave-scheduler@1.0` (fungible tokens and collectibles
 * alike) read their messages from Arweave L1, so a transfer is a plain
 * L1 transaction to the token process rather than an ANS-104 item posted
 * to the MU. The transfer is in the tags, whose lowercase names are what
 * that scheduler matches, and the only AR it moves is the activation
 * winston below. The sender pays the network reward.
 */
const ATOMIC = /^[1-9]\d*$/;

/**
 * The AR a transfer moves to a process that holds none. A node refuses a
 * transaction whose target, after it applies, has no account or a zero
 * balance with no last transaction (`ar_tx:validate_overspend`). A process
 * never signs, so it needs a balance, and a transfer of 0 to a new one is
 * rejected as "Transaction verification failed". The winston stays at the
 * process's keyless address. HyperBEAM's tx codec keeps the `quantity`
 * tag as the message's `quantity`, so the token still reads the tag.
 */
export const L1_ACTIVATION_WINSTON = "1";

async function activationValue(gatewayUrl: string, processId: string): Promise<Winston> {
  return (await getBalance(processId, gatewayUrl)) === "0" ? L1_ACTIVATION_WINSTON : "0";
}

/**
 * What an L1 transfer to `processId` costs the sender: the network reward,
 * plus `L1_ACTIVATION_WINSTON` when the process holds no AR. The review
 * shows the sum as its fee.
 */
export async function estimateL1TransferFee(gatewayUrl: string, processId: string): Promise<Winston> {
  const [{ fee }, value] = await Promise.all([estimateFee(gatewayUrl, processId), activationValue(gatewayUrl, processId)]);
  return (BigInt(fee) + BigInt(value)).toString();
}

export function l1TransferTags(recipient: string, quantity: string): Tag[] {
  return [
    { name: "action", value: "transfer" },
    { name: "recipient", value: recipient },
    { name: "quantity", value: quantity },
  ];
}

/**
 * The unsigned transaction that moves `quantity` atomic units of
 * `processId` from `ownerB64Url` to `recipient`. `fee` is the approved
 * `estimateL1TransferFee`: the reward plus the activation winston, if the
 * process still holds no AR.
 */
export async function prepareL1TokenTransfer(
  gatewayUrl: string,
  ownerB64Url: string,
  processId: string,
  recipient: string,
  quantity: string,
  fee: Winston,
): Promise<ArweaveTransactionJson> {
  if (!ARWEAVE_ID.test(processId)) {
    throw new Error(`Token process must be an Arweave id (43 base64url characters), got "${processId}".`);
  }
  if (!ARWEAVE_ID.test(recipient)) {
    throw new Error(userErrorMessage("recipientInvalid", { recipient }));
  }
  if (!ATOMIC.test(quantity)) {
    throw new Error(`Transfer quantity must be a positive whole number of the token's smallest unit, got "${quantity}".`);
  }
  const value = await activationValue(gatewayUrl, processId);
  const reward = BigInt(fee) - BigInt(value);
  if (reward < 0n) throw new Error(`A fee of ${fee} winston can't pay the ${value} winston a new process needs.`);
  return prepareTransfer(gatewayUrl, ownerB64Url, processId, value, reward.toString(), l1TransferTags(recipient, quantity));
}

/**
 * How a transaction to a token process reads as a token transfer.
 * `unreadable` is one that looks like a transfer (an `action` tag of
 * `transfer`) but has no single clean reading, so it must be shown as the
 * plain transaction it is, with a warning, rather than as zero AR alone.
 */
export type L1TokenTransferReading =
  | { kind: "transfer"; processId: string; recipient: string; quantity: string; value: Winston }
  | { kind: "unreadable" };

/**
 * Reads a transaction as `prepareL1TokenTransfer`'s output, or null when
 * it doesn't look like a token transfer at all. `tags` are plain text.
 * Tags are matched by name, case-insensitively and in any order, with
 * other tags allowed, because the scheduler and HyperBEAM's `dev_token`
 * read them that way. A name given twice is unreadable: the token could
 * act on either copy. So is any `Assign-To` tag, since the scheduler also
 * hands the transaction to each process it names, and each one would run
 * the same transfer of its own token. `value` is the transaction's own AR:
 * 0, or the `L1_ACTIVATION_WINSTON` a process with no balance needs.
 */
export function readL1TokenTransfer(transaction: {
  target: string;
  quantity: string;
  data_size: string;
  tags: readonly Tag[];
}): L1TokenTransferReading | null {
  if (!ARWEAVE_ID.test(transaction.target)) return null;
  const named = (name: string) => transaction.tags.filter((tag) => tag.name.toLowerCase() === name);
  const actions = named("action");
  if (!actions.some((tag) => tag.value.toLowerCase() === "transfer")) return null;
  const only = (name: string): string | null => {
    const matches = named(name);
    return matches.length === 1 ? matches[0]!.value : null;
  };
  const recipient = only("recipient");
  const quantity = only("quantity");
  const value = transaction.quantity || "0";
  if (
    actions.length !== 1 ||
    named("assign-to").length > 0 ||
    (value !== "0" && value !== L1_ACTIVATION_WINSTON) ||
    transaction.data_size !== "0" ||
    recipient === null ||
    !ARWEAVE_ID.test(recipient) ||
    quantity === null ||
    !ATOMIC.test(quantity)
  ) {
    return { kind: "unreadable" };
  }
  return { kind: "transfer", processId: transaction.target, recipient, quantity, value };
}
