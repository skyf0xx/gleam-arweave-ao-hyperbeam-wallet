import { isValidArweaveAddress, type Contact, type StoragePort, isValidContact } from "@gleam/core";
import { userErrorMessage } from "@gleam/core/src/models/user-errors.ts";
import { updateStored } from "../storage-update";
import { CONTACTS_KEY } from "../storage-keys";

const MAX_NAME_LENGTH = 32;

function contactsOf(raw: unknown): Contact[] {
  return Array.isArray(raw) ? raw.filter(isValidContact) : [];
}

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
export class ContactsHandler {
  constructor(private readonly storage: StoragePort) {}

  private async loadContacts(): Promise<Contact[]> {
    return contactsOf(await this.storage.get<unknown>(CONTACTS_KEY));
  }

  async listContacts(): Promise<Contact[]> {
    return this.loadContacts();
  }

  async saveContact(req: { address: string; name: string }): Promise<Contact> {
    const address = req.address.trim();
    const name = req.name.trim();
    if (!isValidArweaveAddress(address)) {
      throw new Error(userErrorMessage("enterValidAddress"));
    }
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw new Error(userErrorMessage("enterContactName", { max: MAX_NAME_LENGTH }));
    }

    const contact: Contact = { address, name, createdAt: Date.now() };
    await updateStored(this.storage, CONTACTS_KEY, (raw) => {
      const existing = contactsOf(raw);
      // Upsert by address: replace an existing entry in place (keeping the
      // list's order stable) rather than appending a duplicate.
      const existingIndex = existing.findIndex((candidate) => candidate.address === address);
      return existingIndex === -1
        ? [contact, ...existing]
        : existing.map((candidate, index) => (index === existingIndex ? contact : candidate));
    });
    return contact;
  }

  async deleteContact(req: { address: string }): Promise<void> {
    await updateStored(this.storage, CONTACTS_KEY, (raw) => {
      const existing = contactsOf(raw);
      const next = existing.filter((candidate) => candidate.address !== req.address);
      return next.length === existing.length ? undefined : next;
    });
  }
}
