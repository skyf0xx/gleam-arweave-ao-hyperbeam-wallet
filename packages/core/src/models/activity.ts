import type { CollectibleRef } from "./collectible";

export type ActivityType = "send" | "receive" | "upload";
export type ActivityStatus = "pending" | "confirmed" | "failed";

/**
 * One row in the local action log (optimistic, written on submit) or the
 * merged gateway GraphQL result. Belongs to a Wallet's address, as owner
 * or recipient.
 */
export interface ActivityEntry {
  txId: string;
  type: ActivityType;
  status: ActivityStatus;
  address: string;
  /**
   * Atomic-integer string; never a floating-point number. Winston units
   * when `token` is `null` (the native AR path); otherwise an atomic
   * integer string in the AO token's own smallest unit, per its resolved
   * denomination.
   */
  amount: string | null;
  tags: Array<{ name: string; value: string }>;
  timestamp: number;
  /**
   * Same convention as `TransferDraft.token`: `null`/omitted denotes the
   * native AR token; otherwise an AO token processId.
   */
  token?: string | null;
  /**
   * Why a `"failed"` entry failed — the AO token process's own rejection
   * reason (`ao/result.ts`'s `Transfer-Error`/thrown-handler `Error`, or
   * the gateway-indexed `Error` tag `mergeActivity` detects), shown
   * verbatim in the activity row. `null`/omitted for a non-AO failure or
   * one whose reason wasn't captured.
   */
  error?: string | null;
  /**
   * Set on a collectible send: an L1 transaction to the asset process that
   * moves no AR, so the row shows the collectible instead of an amount.
   * `address` is the recipient named in its tags, not the asset.
   */
  collectible?: CollectibleRef | null;
  /**
   * Set on an L1 token receive (`arweave/graphql.ts`'s
   * `queryL1TokenReceipts`): the record is a transfer request anyone can
   * sign, and nothing on-chain says the token process honoured it. The
   * row says so instead of presenting it as received.
   */
  unverified?: true;
  /**
   * Set on a market order the wallet placed (`register-interest` to an
   * asset process, `arweave/graphql.ts`). The transaction moves about one
   * winston, which is not the trade. Whether the order filled, and for how
   * much, is the asset process's state and isn't on this transaction, so
   * the row says an order was placed and never that tokens arrived.
   * `amount` is null.
   */
  swap?: { process: string };
}

export interface ActivityPage {
  entries: ActivityEntry[];
  cursor: string | null;
}
