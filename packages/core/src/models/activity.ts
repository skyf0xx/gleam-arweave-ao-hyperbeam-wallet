export type ActivityType = "send" | "receive" | "upload";
export type ActivityStatus = "pending" | "confirmed" | "failed";

/**
 * One row in the local action log (optimistic, written on submit) or the
 * merged gateway GraphQL result. Belongs to a Wallet's address, as owner or
 * recipient (PRD §3 Glossary — ActivityEntry).
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
   * denomination — same convention as `TokenBalance.quantity` and
   * `TransferDraft.amount`'s AO-token case, never Winston-shaped for an
   * AO entry.
   */
  amount: string | null;
  tags: Array<{ name: string; value: string }>;
  timestamp: number;
  /**
   * Same convention as `TransferDraft.token`: `null` (or omitted, for the
   * AR-only entries every gateway/`arweave`-path producer already writes
   * before this field existed) denotes the native AR token; otherwise an
   * AO token processId. Added so an AO token send/receive entry can't be
   * conflated with an AR entry, or with a different token's entry, once a
   * later layer starts writing AO entries alongside the existing AR ones
   * — `mergeActivity`'s txId-keyed dedup is unaffected, since AO message
   * IDs and AR transaction IDs are drawn from disjoint id spaces.
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
