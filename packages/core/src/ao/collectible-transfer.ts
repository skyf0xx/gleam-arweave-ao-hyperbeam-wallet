import type { ArweaveTransactionJson } from "../arweave/transaction";
import type { Winston } from "../models/balance";
import type { Tag } from "../models/tag";
import { l1TransferTags, prepareL1TokenTransfer, readL1TokenTransfer } from "./l1-transfer";

/**
 * A collectible is an `arweave-scheduler@1.0` asset with a supply of one,
 * so sending it is `ao/l1-transfer.ts`'s L1 transfer of quantity 1.
 */
export const COLLECTIBLE_TRANSFER_QUANTITY = "1";

const WINSTON_PER_AR = 1_000_000_000_000n;

export function collectibleTransferTags(recipient: string): Tag[] {
  return l1TransferTags(recipient, COLLECTIBLE_TRANSFER_QUANTITY);
}

/** The unsigned transaction that moves collectible `assetId` from `ownerB64Url` to `recipient`. */
export async function prepareCollectibleTransfer(
  gatewayUrl: string,
  ownerB64Url: string,
  assetId: string,
  recipient: string,
): Promise<ArweaveTransactionJson> {
  return prepareL1TokenTransfer(gatewayUrl, ownerB64Url, assetId, recipient, COLLECTIBLE_TRANSFER_QUANTITY);
}

/**
 * The asset and recipient of a transaction shaped exactly like
 * `prepareCollectibleTransfer`'s output, or null. `tags` are plain text.
 */
export function readCollectibleTransfer(transaction: {
  target: string;
  quantity: string;
  data_size: string;
  tags: Tag[];
}): { assetId: string; recipient: string } | null {
  const transfer = readL1TokenTransfer(transaction);
  if (!transfer || transfer.quantity !== COLLECTIBLE_TRANSFER_QUANTITY) return null;
  return { assetId: transfer.processId, recipient: transfer.recipient };
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
