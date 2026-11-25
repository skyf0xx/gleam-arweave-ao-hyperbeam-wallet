import type { ActivityPage, Contact, WalletSummary } from "@gleam/core";

export interface NamedAddress {
  address: string;
  name: string;
  /** One of your own wallets rather than a contact. */
  own: boolean;
}

/**
 * Saved contacts and the vault's other wallets, for the recipient field's
 * dropdown, ordered by how recently each was sent to; never-sent-to ones
 * keep their list order at the end. A contact wins over a wallet with the
 * same address.
 */
export function namedSuggestions(
  contacts: Contact[],
  otherWallets: WalletSummary[],
  activity: ActivityPage | undefined,
): NamedAddress[] {
  const contactAddresses = new Set(contacts.map((contact) => contact.address));
  const named: NamedAddress[] = [
    ...contacts.map(({ address, name }) => ({ address, name, own: false })),
    ...otherWallets
      .filter((candidate) => !contactAddresses.has(candidate.address))
      .map(({ address, name }) => ({ address, name, own: true })),
  ];
  const recency = activity ? recentSendRecipients(activity) : [];
  const rank = (address: string) => {
    const index = recency.indexOf(address);
    return index === -1 ? recency.length : index;
  };
  // Your own wallets after contacts, as the full picker groups them
  return named.sort((a, b) => Number(a.own) - Number(b.own) || rank(a.address) - rank(b.address));
}

/**
 * Pure extraction — separated from `RecentRecipientsStep` so it's testable
 * without mounting the component. `mergeActivity` (`core/activity/merge.ts`)
 * already returns entries most-recent-first (its own doc contract), so
 * this only needs to filter/map/dedupe, not re-sort — but sorts
 * defensively by `timestamp` descending anyway rather than assuming the
 * caller's ordering contract silently holds forever.
 */
export function recentSendRecipients(activity: ActivityPage): string[] {
  const sendEntries = activity.entries
    .filter((entry) => entry.type === "send")
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);

  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const entry of sendEntries) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    recipients.push(entry.address);
  }
  return recipients;
}
