import { describe, expect, it } from "vitest";
import type { StoragePort } from "@gleam/core";
import { ContactsHandler } from "./contacts";

function createFakeStorage(): StoragePort {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return store.has(key) ? (store.get(key) as T) : null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async remove(key: string) {
      store.delete(key);
    },
    watch() {
      return () => {};
    },
  };
}

const ADDRESS_A = "aB3k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx1234";
const ADDRESS_B = "zZ9k4f9qP2xR8m1tN6vW3jL7yH0sD9eK5cF9fQx5678";

describe("ContactsHandler", () => {
  it("starts empty", async () => {
    const handler = new ContactsHandler(createFakeStorage());
    expect(await handler.listContacts()).toEqual([]);
  });

  it("saves a contact and lists it back, trimming the name", async () => {
    const handler = new ContactsHandler(createFakeStorage());
    const saved = await handler.saveContact({ address: ADDRESS_A, name: "  Alice  " });
    expect(saved).toMatchObject({ address: ADDRESS_A, name: "Alice" });

    const contacts = await handler.listContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ address: ADDRESS_A, name: "Alice" });
  });

  it("rejects a blank or overlong name without touching storage", async () => {
    const handler = new ContactsHandler(createFakeStorage());
    await expect(handler.saveContact({ address: ADDRESS_A, name: "   " })).rejects.toThrow();
    await expect(handler.saveContact({ address: ADDRESS_A, name: "x".repeat(33) })).rejects.toThrow();
    expect(await handler.listContacts()).toEqual([]);
  });

  it("rejects an address that isn't a valid 43-character Arweave address, without touching storage", async () => {
    const handler = new ContactsHandler(createFakeStorage());
    await expect(handler.saveContact({ address: "too-short", name: "Alice" })).rejects.toThrow();
    await expect(handler.saveContact({ address: `${ADDRESS_A}extra`, name: "Alice" })).rejects.toThrow();
    await expect(handler.saveContact({ address: "", name: "Alice" })).rejects.toThrow();
    expect(await handler.listContacts()).toEqual([]);
  });

  it("upserts by address: saving the same address again replaces the name, not adds a duplicate", async () => {
    const handler = new ContactsHandler(createFakeStorage());
    await handler.saveContact({ address: ADDRESS_A, name: "Alice" });
    await handler.saveContact({ address: ADDRESS_A, name: "Alice W." });

    const contacts = await handler.listContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe("Alice W.");
  });

  it("deletes a contact by address", async () => {
    const handler = new ContactsHandler(createFakeStorage());
    await handler.saveContact({ address: ADDRESS_A, name: "Alice" });
    await handler.saveContact({ address: ADDRESS_B, name: "Bob" });

    await handler.deleteContact({ address: ADDRESS_A });

    const contacts = await handler.listContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.address).toBe(ADDRESS_B);
  });

  it("deleting an address that isn't saved is a no-op", async () => {
    const handler = new ContactsHandler(createFakeStorage());
    await handler.saveContact({ address: ADDRESS_A, name: "Alice" });

    await expect(handler.deleteContact({ address: ADDRESS_B })).resolves.toBeUndefined();
    expect(await handler.listContacts()).toHaveLength(1);
  });
});
