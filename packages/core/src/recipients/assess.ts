import type { ActivityEntry } from "../models/activity";

export interface RecipientAssessment {
  /** No prior activity with this address, and it is not a saved contact or one of your wallets. */
  firstTime: boolean;
  /** A trusted address that shares this one's first and last characters but differs in between. */
  lookalikeOf: string | null;
}

/** Characters compared at each end; wallets and block explorers truncate to about this many. */
export const LOOKALIKE_EDGE_LENGTH = 4;

/**
 * Whether `recipient` is an address-poisoning lookalike of `known`: same
 * first and last `LOOKALIKE_EDGE_LENGTH` characters, different address.
 * An attacker grinds a vanity address to match a victim's past counterparty
 * and sends dust so it shows up in the history the victim copies from.
 */
export function isLookalike(recipient: string, known: string): boolean {
  if (recipient === known) return false;
  const minLength = LOOKALIKE_EDGE_LENGTH * 2 + 1;
  if (recipient.length < minLength || known.length < minLength) return false;
  return (
    recipient.startsWith(known.slice(0, LOOKALIKE_EDGE_LENGTH)) &&
    recipient.endsWith(known.slice(-LOOKALIKE_EDGE_LENGTH))
  );
}

/**
 * `history` is every activity entry available (local log plus gateway
 * results); `entry.address` is the counterparty. `knownAddresses` are
 * trusted without history: saved contacts and the user's own wallets.
 *
 * Only known addresses and addresses the user has sent to count as
 * references for the lookalike check. The poisoner's dust arrives as a
 * receive, so a received-only address can itself be the fake: it shows up in
 * history, which is why `lookalikeOf` is checked even when the address has
 * been seen. When several references resemble the recipient, the most
 * recently sent-to one wins.
 */
export function assessRecipient(
  recipient: string,
  history: ActivityEntry[],
  knownAddresses: string[] = [],
): RecipientAssessment {
  const sentTo = history
    .filter((entry) => entry.type === "send")
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((entry) => entry.address);
  const references = [...knownAddresses, ...sentTo];

  if (references.includes(recipient)) {
    return { firstTime: false, lookalikeOf: null };
  }

  const lookalikeOf = references.find((address) => isLookalike(recipient, address)) ?? null;
  const seen = history.some((entry) => entry.address === recipient);
  return { firstTime: !seen, lookalikeOf };
}
