import { isRecord } from "./guards";
import { isArweaveId } from "./arweave-id";

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

export function isValidContact(value: unknown): value is Contact {
  if (!isRecord(value)) return false;
  const { address, name, createdAt } = value;
  return (
    typeof address === "string" &&
    isValidArweaveAddress(address) &&
    typeof name === "string" &&
    name.length > 0 &&
    typeof createdAt === "number"
  );
}

export function isValidArweaveAddress(value: string): boolean {
  return isArweaveId(value);
}
