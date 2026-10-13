import type { ActivityEntry, ActivityPage } from "../models/activity";

/**
 * Combines the local action log (append-only, optimistic entries written
 * on submit) with one gateway GraphQL query result into a unified,
 * deduplicated, most-recent-N `ActivityPage`.
 *
 * Dedup rule: entries are keyed by `txId`. When both sources report the
 * same `txId`, the gateway entry wins once it is in a block — it carries
 * a real `"confirmed"` where the local entry may still say "pending". A
 * gateway entry with no block yet keeps the local entry's status. The
 * local entry survives alone for `txId`s the gateway hasn't indexed yet.
 *
 * Exception: a local entry already settled as `"failed"` stays failed. The
 * gateway indexing a message only proves it reached the network; a local
 * failure comes from the AO process's own evaluated result
 * (`ao/result.ts`), which is the authority on whether a transfer executed.
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
    if (!local) {
      byTxId.set(entry.txId, settled);
      continue;
    }
    const timestamp = settled.timestamp > 0 ? settled.timestamp : local.timestamp;
    // The gateway only knows a sent collectible's process id; the local
    // entry kept its name and image.
    const collectible = local.collectible ?? settled.collectible;
    const extra = collectible ? { timestamp, collectible } : { timestamp };
    if (local.status === "failed") {
      byTxId.set(entry.txId, { ...settled, ...extra, status: "failed", error: local.error ?? settled.error });
    } else if (settled.status === "pending") {
      // Indexed but not yet in a block says nothing new; keep the local
      // status, which the CU result may already have settled.
      byTxId.set(entry.txId, { ...local, timestamp });
    } else {
      byTxId.set(entry.txId, { ...settled, ...extra });
    }
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
 * re-tags its `status` as `"failed"`: a gateway-indexed transaction has
 * definitely reached the network, but that says nothing about whether
 * the AO process's own message handler accepted it.
 *
 * An entry is a candidate only if it carries `Data-Protocol: ao` (an
 * AR-native send/receive never does), and is marked `"failed"` only
 * when it also carries an explicit `Error` tag, per AO's convention for
 * a message a process rejected or a handler threw on. Tag names/values
 * are matched case-insensitively, matching observed gateway casing.
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
 * (handlers/transfer.ts) uses to escalate its review-screen framing.
 * Checked against the union so a pending local send-in-flight to the
 * same address still counts as "seen".
 */
export function isFirstSeenRecipient(
  recipient: string,
  localLog: ActivityEntry[],
  gatewayEntries: ActivityEntry[],
): boolean {
  return ![...localLog, ...gatewayEntries].some((entry) => entry.address === recipient);
}
