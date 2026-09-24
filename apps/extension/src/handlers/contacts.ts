import { isValidArweaveAddress, type Contact, type StoragePort } from "@gleam/core";

/**
 * Background-side implementation of `ProtocolMap`'s `listContacts`/
 * `saveContact`/`deleteContact` — same constructor-injected-`StoragePort`
 * shape as `ReadsHandler`/`WalletLifecycleHandler`, for the same
 * hexagonal reason: this file knows `StoragePort`'s shape, never
 * `wxt/utils/storage`.
 *
 * Storage schema this handler owns:
 * - `local:contacts` — `Contact[]`, one list for the whole vault (not
 *   per-wallet), most-recently-saved first. An address a user has saved
 *   is meaningful regardless of which of their own wallets is active.
 */
const CONTACTS_KEY = "local:contacts";
const MAX_NAME_LENGTH = 32;

export class ContactsHandler {
  constructor(private readonly storage: StoragePort) {}

  private async loadContacts(): Promise<Contact[]> {
    const raw = await this.storage.get<unknown>(CONTACTS_KEY);
    return Array.isArray(raw) ? (raw as Contact[]) : [];
  }

  async listContacts(): Promise<Contact[]> {
    return this.loadContacts();
  }

  async saveContact(req: { address: string; name: string }): Promise<Contact> {
    const address = req.address.trim();
    const name = req.name.trim();
    if (!isValidArweaveAddress(address)) {
      throw new Error("Enter a valid Arweave address.");
    }
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw new Error(`Enter a name up to ${MAX_NAME_LENGTH} characters.`);
    }

    const existing = await this.loadContacts();
    const contact: Contact = { address, name, createdAt: Date.now() };
    // Upsert by address: replace an existing entry in place (keeping the
    // list's order stable) rather than appending a duplicate.
    const existingIndex = existing.findIndex((candidate) => candidate.address === address);
    const next =
      existingIndex === -1
        ? [contact, ...existing]
        : existing.map((candidate, index) => (index === existingIndex ? contact : candidate));

    await this.storage.set(CONTACTS_KEY, next);
    return contact;
  }

  async deleteContact(req: { address: string }): Promise<void> {
    const existing = await this.loadContacts();
    const next = existing.filter((candidate) => candidate.address !== req.address);
    if (next.length === existing.length) return;
    await this.storage.set(CONTACTS_KEY, next);
  }
}
