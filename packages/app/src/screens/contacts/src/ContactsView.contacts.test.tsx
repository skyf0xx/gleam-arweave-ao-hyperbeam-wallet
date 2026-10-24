import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Contact, RuntimePort } from "@gleam/core";
import { ContactsView } from "./ContactsView";

afterEach(() => {
  cleanup();
});

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const CONTACT_1: Contact = { address: "a".repeat(43), name: "Alice", createdAt: 1 };
const CONTACT_2: Contact = { address: "b".repeat(43), name: "Bob", createdAt: 2 };

describe("ContactsView", () => {
  it("shows an empty state with no contacts", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "listContacts") return [];
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ContactsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("No contacts yet.")).toBeTruthy());
  });

  it("lists saved contacts by name", async () => {
    const send = vi.fn(async ({ type }: { type: string }) => {
      if (type === "listContacts") return [CONTACT_1, CONTACT_2];
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ContactsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    expect(screen.getByText("Bob")).toBeTruthy();
  });

  it("adds a new contact through the + form after validating the address", async () => {
    const send = vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
      if (type === "listContacts") return [];
      if (type === "saveContact") return { ...(payload as { address: string; name: string }), createdAt: 1 };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ContactsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("No contacts yet.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));

    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Carol" } });
    fireEvent.change(screen.getByPlaceholderText("Arweave address (43 characters)"), {
      target: { value: "not-a-valid-address" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a valid Arweave address.")).toBeTruthy();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "saveContact" }));

    fireEvent.change(screen.getByPlaceholderText("Arweave address (43 characters)"), {
      target: { value: "c".repeat(43) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "saveContact",
        payload: { address: "c".repeat(43), name: "Carol" },
      }),
    );
  });

  it("edits a contact's name inline by tapping its row", async () => {
    const send = vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
      if (type === "listContacts") return [CONTACT_1];
      if (type === "saveContact") return { ...(payload as { address: string; name: string }), createdAt: 1 };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ContactsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    fireEvent.click(screen.getByText("Alice"));

    const input = await screen.findByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Alice Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "saveContact",
        payload: { address: CONTACT_1.address, name: "Alice Renamed" },
      }),
    );
  });

  it("deletes a contact immediately with no confirmation, then shows an Undo toast", async () => {
    const send = vi.fn(async ({ type, payload }: { type: string; payload: unknown }) => {
      if (type === "listContacts") return [CONTACT_1];
      if (type === "deleteContact") return undefined;
      if (type === "saveContact") return { ...(payload as { address: string; name: string }), createdAt: 1 };
      throw new Error(`Unexpected message type "${type}"`);
    }) as RuntimePort["send"];

    renderWithClient(<ContactsView runtime={fakeRuntime({ send })} onBack={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Alice")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Delete Alice" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ type: "deleteContact", payload: { address: CONTACT_1.address } }),
    );
    expect(await screen.findByText("Alice deleted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "saveContact",
        payload: { address: CONTACT_1.address, name: "Alice" },
      }),
    );
  });
});
