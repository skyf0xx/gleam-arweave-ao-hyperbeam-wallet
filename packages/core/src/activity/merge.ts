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
 * Exception: a local entry already settled as `"failed"` stays failed. The
 * gateway indexing a message only proves it reached the network; a local
 * failure comes from the AO process's own evaluated result
 * (`ao/result.ts`), which is the authority on whether a transfer executed.
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
    const settled = withFailedAoTransferDetection(entry);
    const local = byTxId.get(entry.txId);
    byTxId.set(
      entry.txId,
      local?.status === "failed" ? { ...settled, status: "failed", error: local.error ?? settled.error } : settled,
    );
  }

  const merged = [...byTxId.values()].sort((a, b) => b.timestamp - a.timestamp);
  const entries = merged.slice(0, limit);

  return {
    entries,
    cursor: merged.length > limit ? entries[entries.length - 1]?.txId ?? null : null,
  };
}

/**
 * Detects a failed AO transfer among gateway-sourced entries and
 * re-tags its `status` as `"failed"` rather than leaving it reported as
 * the default gateway-index-implies-`"confirmed"` (`graphql.ts`'s
 * `toAoActivityEntry`/`toActivityEntry` — a gateway-indexed transaction
 * has definitely reached the network, but that says nothing about
 * whether the AO process's own message handler accepted the transfer).
 *
 * Detection reads the tags every AO Data Item carries per its own
 * `Data-Protocol: ao` convention (matched case-insensitively, the same
 * way `token-metadata.ts`'s `toTokenMetadata` already handles observed
 * lower-cased gateway tag casing): an entry is only a candidate for this
 * check at all if it carries `Data-Protocol: ao` (an AR-native send/
 * receive never does, so this never touches non-AO entries), and is
 * marked `"failed"` when it also carries an explicit AO-error signal —
 * an `Error` tag, per AO's own convention for a message a process
 * rejected or a handler threw on. A `Data-Protocol: ao` entry with no
 * `Error` tag is left exactly as `graphql.ts` reported it
 * (`"confirmed"`) — this never invents a failure the tags don't state.
 */
function withFailedAoTransferDetection(entry: ActivityEntry): ActivityEntry {
  const isAoProtocol = entry.tags.some(
    (tag) => tag.name.toLowerCase() === "data-protocol" && tag.value.toLowerCase() === "ao",
  );
  if (!isAoProtocol) return entry;

  const errorTag = entry.tags.find((tag) => tag.name.toLowerCase() === "error");
  if (!errorTag) return entry;

  return { ...entry, status: "failed", error: errorTag.value };
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
