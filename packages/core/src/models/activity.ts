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
  /** Winston atomic-integer string; never a floating-point number. */
  amount: string | null;
  tags: Array<{ name: string; value: string }>;
  timestamp: number;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  cursor: string | null;
}
