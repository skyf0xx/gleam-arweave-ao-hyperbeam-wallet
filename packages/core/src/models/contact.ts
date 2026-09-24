/**
 * A saved address-book entry. One list for the whole vault (not
 * per-wallet) since an address a user sends to is meaningful regardless of
 * which of their own wallets is currently active. Deduped by `address` —
 * saving over an existing address replaces its name rather than creating a
 * second entry.
 */
export interface Contact {
  address: string;
  /** 1-32 characters, trimmed. */
  name: string;
  createdAt: number;
}

/**
 * An Arweave address's on-the-wire shape: 43 base64url characters (a
 * 32-byte id). Same pattern used ad hoc elsewhere (`ao/transfer.ts`'s
 * `createSignedDataItem`, `provider-params.ts`'s `ADDRESS_PATTERN`,
 * `sendFormSchema.ts`'s `recipientSchema`) — exported here so
 * `saveContact` (and any future core caller) can share one definition
 * instead of re-declaring the regex.
 */
const ARWEAVE_ADDRESS_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidArweaveAddress(value: string): boolean {
  return ARWEAVE_ADDRESS_PATTERN.test(value);
}
