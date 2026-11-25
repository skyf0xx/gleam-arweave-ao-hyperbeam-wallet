import { estimateFee, prepareTransfer } from "../arweave/transfer";
import type { ArweaveTransactionJson } from "../arweave/transaction";
import type { Winston } from "../models/balance";
import type { Tag } from "../models/tag";
import { userErrorMessage } from "../models/user-errors";
import { withRequestTimeout } from "./asset-scan";
import { readCarrierHolding, readCarrierState } from "./names";
import { isArweaveId } from "../models/arweave-id";

/**
 * Pointing a Permaweb Name somewhere else is a `set` on its carrier: an L1
 * transaction to the carrier with `action=set` and `reference-value=<id>`.
 * A `set` has no `quantity` tag, so the carrier reads the transaction's own
 * quantity as the message's, and every `set` on chain carries exactly 1
 * winston. The winston stays at the carrier's keyless address.
 */
export const NAME_TARGET_WINSTON = "1";


export function nameTargetTags(target: string): Tag[] {
  return [
    { name: "action", value: "set" },
    { name: "reference-value", value: target },
  ];
}

/** The network reward for a data-less transaction to the carrier, plus the 1 winston it carries. */
export async function estimateNameTargetFee(gatewayUrl: string, carrier: string): Promise<Winston> {
  const { fee } = await estimateFee(gatewayUrl, carrier);
  return (BigInt(fee) + BigInt(NAME_TARGET_WINSTON)).toString();
}

/** The unsigned `set` that points `carrier` at `target`; `fee` is the approved `estimateNameTargetFee`. */
export async function prepareNameTarget(
  gatewayUrl: string,
  ownerB64Url: string,
  carrier: string,
  target: string,
  fee: Winston,
): Promise<ArweaveTransactionJson> {
  if (!isArweaveId(carrier)) throw new Error(userErrorMessage("collectibleIdInvalid"));
  if (!isArweaveId(target)) throw new Error(userErrorMessage("nameTargetInvalid"));
  const reward = BigInt(fee) - BigInt(NAME_TARGET_WINSTON);
  if (reward < 0n) throw new Error(`A fee of ${fee} winston can't pay the ${NAME_TARGET_WINSTON} winston a set carries.`);
  return prepareTransfer(gatewayUrl, ownerB64Url, carrier, NAME_TARGET_WINSTON, reward.toString(), nameTargetTags(target));
}

/**
 * Reads a transaction as `prepareNameTarget`'s output, or null. Strict:
 * exactly the two tags in order, no data, 1 winston. Anything else is not
 * shown as a name change.
 */
export function readNameTarget(transaction: {
  target: string;
  quantity: string;
  data_size: string;
  tags: readonly Tag[];
}): { carrier: string; target: string } | null {
  const [action, value, ...rest] = transaction.tags;
  if (
    !isArweaveId(transaction.target) ||
    transaction.quantity !== NAME_TARGET_WINSTON ||
    transaction.data_size !== "0" ||
    rest.length > 0 ||
    action?.name !== "action" ||
    action.value !== "set" ||
    value?.name !== "reference-value" ||
    !isArweaveId(value.value)
  ) {
    return null;
  }
  return { carrier: transaction.target, target: value.value };
}

/**
 * Throws unless `address` holds `carrier` right now: a balance of 1, not
 * escrowed into a sale. Read live, since the cached gallery can be an hour
 * old and a carrier ignores a `set` from anyone but its holder.
 */
export async function assertHoldsName(
  carrier: string,
  address: string,
  hosts: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let state: unknown;
  try {
    state = await readCarrierState(carrier, hosts, withRequestTimeout(fetchImpl));
  } catch (error) {
    throw new Error(userErrorMessage("nameStateUnavailable"), { cause: error });
  }
  const holding = readCarrierHolding(state, address);
  if (holding?.status !== "held") throw new Error(userErrorMessage("nameNotHeld"));
}
