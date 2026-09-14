import type { ActivityEntry, ActivityPage } from "../models/activity";

/**
 * Combines the local action log (append-only, optimistic entries written
 * on submit — see `handlers/transfer.ts`) with one gateway GraphQL query
 * result into a unified, deduplicated, most-recent-N `ActivityPage` (PRD
 * "Activity feed is the union of the local action log and one gateway
 * GraphQL transactions query by owner and recipient, most-recent-N").
 *
 * Dedup rule: entries are keyed by `txId`. When both sources report the
 * same `txId`, the gateway entry wins — it carries a real `status`
 * ("confirmed", since GraphQL only indexes settled transactions) where
 * the local entry may still say "pending" from the moment it was
 * optimistically written. The local entry survives only for `txId`s the
 * gateway hasn't indexed yet (still genuinely pending, or the gateway
 * hasn't caught up).
 *
 * Pure: no `chrome.*`/window/document/network dependency — the caller
 * (a handler) is responsible for producing both input arrays.
 */
export function mergeActivity(
  localLog: ActivityEntry[],
  gatewayEntries: ActivityEntry[],
  limit: number,
): ActivityPage {
  const byTxId = new Map<string, ActivityEntry>();

  for (const entry of localLog) {
    byTxId.set(entry.txId, entry);
  }
  for (const entry of gatewayEntries) {
    // Gateway entries win on conflict — see doc comment.
    byTxId.set(entry.txId, entry);
  }

  const merged = [...byTxId.values()].sort((a, b) => b.timestamp - a.timestamp);
  const entries = merged.slice(0, limit);

  return {
    entries,
    cursor: merged.length > limit ? entries[entries.length - 1]?.txId ?? null : null,
  };
}

/**
 * Whether `recipient` has no prior confirmed-or-pending activity in
 * either source — the "first-seen-address" signal `estimateTransfer`
 * (handlers/transfer.ts) uses to escalate the Irreversible-tier framing
 * (PRD "Send review screen ... a first-seen-address escalates to
 * Irreversible-tier framing"). Checked against the union so a pending
 * local send-in-flight to the same address still counts as "seen."
 */
export function isFirstSeenRecipient(
  recipient: string,
  localLog: ActivityEntry[],
  gatewayEntries: ActivityEntry[],
): boolean {
  return ![...localLog, ...gatewayEntries].some((entry) => entry.address === recipient);
}
