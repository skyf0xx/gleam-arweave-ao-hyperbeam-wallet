import { prepareTransfer } from "../arweave/transfer";
import type { ArweaveTransactionJson } from "../arweave/transaction";
import type { Winston } from "../models/balance";
import type { UploadTag } from "../models/upload";

/**
 * Collectibles run on `arweave-scheduler@1.0`, which reads its messages
 * from Arweave L1, so a send is a plain L1 transaction to the asset
 * process rather than an ANS-104 item posted to the MU. It moves no AR;
 * the transfer is in the tags, whose lowercase names are what that
 * scheduler matches. The sender pays the network reward.
 */
export const COLLECTIBLE_TRANSFER_QUANTITY = "1";

const ADDRESS = /^[A-Za-z0-9_-]{43}$/;
const WINSTON_PER_AR = 1_000_000_000_000n;

export function collectibleTransferTags(recipient: string): UploadTag[] {
  return [
    { name: "action", value: "transfer" },
    { name: "recipient", value: recipient },
    { name: "quantity", value: COLLECTIBLE_TRANSFER_QUANTITY },
  ];
}

/** The unsigned transaction that moves collectible `assetId` from `ownerB64Url` to `recipient`. */
export async function prepareCollectibleTransfer(
  gatewayUrl: string,
  ownerB64Url: string,
  assetId: string,
  recipient: string,
): Promise<ArweaveTransactionJson> {
  if (!ADDRESS.test(recipient)) {
    throw new Error(`Collectible recipient must be an Arweave address (43 base64url characters), got "${recipient}".`);
  }
  return prepareTransfer(gatewayUrl, ownerB64Url, assetId, "0", collectibleTransferTags(recipient));
}

/**
 * The asset and recipient of a transaction shaped exactly like
 * `prepareCollectibleTransfer`'s output, or null. `tags` are plain text.
 */
export function readCollectibleTransfer(transaction: {
  target: string;
  quantity: string;
  data_size: string;
  tags: UploadTag[];
}): { assetId: string; recipient: string } | null {
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
    quantity.value !== COLLECTIBLE_TRANSFER_QUANTITY
  ) {
    return null;
  }
  return { assetId: transaction.target, recipient: recipient.value };
}

/** Throws when `arBalance` can't pay `fee`. */
export function assertCoversNetworkFee(arBalance: Winston, fee: Winston): void {
  if (BigInt(arBalance) < BigInt(fee)) {
    throw new Error(`Sending needs about ${formatAr(fee)} AR for the network fee.`);
  }
}

/** Full precision, trailing zeros trimmed: a network fee is often below 0.0001 AR. */
function formatAr(winston: Winston): string {
  const amount = BigInt(winston);
  const whole = amount / WINSTON_PER_AR;
  const fraction = (amount % WINSTON_PER_AR).toString().padStart(12, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}
