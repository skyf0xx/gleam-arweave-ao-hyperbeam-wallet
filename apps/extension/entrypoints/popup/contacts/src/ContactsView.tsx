import { useRef, useState } from "react";
import type { Contact, RuntimePort } from "@gleam/core";
import { isValidArweaveAddress } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Toast } from "@gleam/ui/src/primitives/toast.tsx";
import { EmptyState, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { AddressRow } from "../../activity/src/AddressRow";
import { useContacts, useDeleteContact, useSaveContact } from "../../activity/src/useContacts";

/**
 * Settings' Contacts screen — "Address book, part 2" per `todo.md`. A flat
 * list of every saved contact (`useContacts`, the same vault-wide query
 * `SendView`'s "Saved addresses" screen reads), each row using the shared
 * `AddressRow` identicon style. "+" reveals an inline add form (name +
 * 43-character address, reusing `isValidArweaveAddress`); tapping a row
 * edits its name in place; deleting removes it immediately with no
 * confirmation dialog — "a contact is only a label" — backed by one `Toast`
 * offering "Undo", which just re-saves the same address/name pair.
 */
export interface ContactsViewProps {
  runtime: RuntimePort;
  onBack: () => void;
}

const MAX_NAME_LENGTH = 32;

export function ContactsView({ runtime, onBack }: ContactsViewProps) {
  const contactsQuery = useContacts(runtime);
  const saveContactMutation = useSaveContact(runtime);
  const deleteContactMutation = useDeleteContact(runtime);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const [undo, setUndo] = useState<Contact | null>(null);
  // Guards against a stale timer clobbering a toast raised by a later
  // delete before the first one's timeout fires.
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contacts = contactsQuery.data ?? [];

  const clearUndoTimer = () => {
    if (undoTimer.current !== null) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  };

  const handleDelete = (contact: Contact) => {
    clearUndoTimer();
    deleteContactMutation.mutate(contact.address, {
      onSuccess: () => {
        setUndo(contact);
        undoTimer.current = setTimeout(() => setUndo(null), 5000);
      },
    });
  };

  const handleUndo = () => {
    if (!undo) return;
    clearUndoTimer();
    saveContactMutation.mutate({ address: undo.address, name: undo.name });
    setUndo(null);
  };

  const handleAdd = () => {
    const address = newAddress.trim();
    const name = newName.trim();
    if (!isValidArweaveAddress(address)) {
      setAddError("Enter a valid Arweave address.");
      return;
    }
    if (name.length === 0) {
      setAddError("Enter a name.");
      return;
    }
    setAddError(null);
    saveContactMutation.mutate(
      { address, name },
      {
        onSuccess: () => {
          setAdding(false);
          setNewName("");
          setNewAddress("");
        },
        onError: (error) => setAddError(error instanceof Error ? error.message : String(error)),
      },
    );
  };

  const startEdit = (contact: Contact) => {
    setEditingAddress(contact.address);
    setEditingName(contact.name);
  };

  const commitEdit = (address: string) => {
    const name = editingName.trim();
    if (name.length === 0) {
      setEditingAddress(null);
      return;
    }
    saveContactMutation.mutate(
      { address, name },
      {
        onSuccess: () => setEditingAddress(null),
      },
    );
  };

  return (
    <div className="relative flex min-h-full flex-col">
      <ScreenHeader
        title="Contacts"
        onBack={onBack}
        end={
          <button
            type="button"
            aria-label="Add contact"
            onClick={() => {
              setAdding((prev) => !prev);
              setAddError(null);
            }}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-foreground hover:bg-mist"
          >
            <PlusIcon />
          </button>
        }
      />

      {adding ? (
        <div className="flex flex-col gap-2 border-b border-line px-3.5 py-3">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value.slice(0, MAX_NAME_LENGTH))}
            placeholder="Name"
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-label text-foreground focus:border-foreground focus:outline-none"
          />
          <input
            type="text"
            value={newAddress}
            onChange={(event) => setNewAddress(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleAdd();
            }}
            placeholder="Arweave address (43 characters)"
            className="w-full rounded-md border border-line bg-background px-3 py-2 font-mono text-label text-foreground focus:border-foreground focus:outline-none"
          />
          {addError ? (
            <span role="alert" className="text-caption text-warning">
              {addError}
            </span>
          ) : null}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setAddError(null);
                setNewName("");
                setNewAddress("");
              }}
              className="text-label font-medium text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <Button type="button" size="sm" disabled={saveContactMutation.isPending} onClick={handleAdd}>
              {saveContactMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col px-1 py-2">
        {contactsQuery.isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : contacts.length === 0 ? (
          <EmptyState message="No contacts yet." />
        ) : (
          contacts.map((contact) =>
            editingAddress === contact.address ? (
              <div key={contact.address} className="flex items-center gap-2 border-b border-line px-3.5 py-3 last:border-b-0">
                <input
                  type="text"
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value.slice(0, MAX_NAME_LENGTH))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitEdit(contact.address);
                    if (event.key === "Escape") setEditingAddress(null);
                  }}
                  onBlur={() => commitEdit(contact.address)}
                  className="min-w-0 flex-1 rounded-md border border-line bg-background px-3 py-2 text-label text-foreground focus:border-foreground focus:outline-none"
                />
              </div>
            ) : (
              <div key={contact.address} className="flex items-center border-b border-line last:border-b-0">
                <div className="min-w-0 flex-1">
                  <AddressRow address={contact.address} name={contact.name} onSelect={() => startEdit(contact)} />
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${contact.name}`}
                  onClick={() => handleDelete(contact)}
                  className="mr-2.5 flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-warning"
                >
                  <RemoveIcon />
                </button>
              </div>
            ),
          )
        )}
      </div>

      {undo ? (
        <Toast message={`${undo.name} deleted`} actionLabel="Undo" onAction={handleUndo} />
      ) : null}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
