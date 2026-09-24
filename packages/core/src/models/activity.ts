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
}

export interface ActivityPage {
  entries: ActivityEntry[];
  cursor: string | null;
}
