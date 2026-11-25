import { useRef, useState } from "react";
import type { Contact, RuntimePort } from "@gleam/core";
import { isValidArweaveAddress } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Toast } from "@gleam/ui/src/primitives/toast.tsx";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { EmptyState } from "@gleam/ui/src/primitives/empty-state.tsx";
import { useT } from "../../../i18n";
import { AddressRow } from "../../activity/src/AddressRow";
import { useContacts, useDeleteContact, useSaveContact } from "../../activity/src/useContacts";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { errorText } from "../../../i18n/errors";
import { CloseIcon } from "@gleam/ui/src/primitives/icons.tsx";
import { InlineInput } from "@gleam/ui/src/primitives/inline-input.tsx";

/**
 * Settings' Contacts screen — "Address book, part 2" per `todo.md`. A flat
 * list of every saved contact (`useContacts`, the same vault-wide query
 * `SendView`'s "Saved contacts" screen reads), each row using the shared
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
  const t = useT();
  const contactsQuery = useContacts(runtime);
  const saveContactMutation = useSaveContact(runtime);
  const deleteContactMutation = useDeleteContact(runtime);

  const [adding, setAdding] = useState(false);
  useBackHandler(adding ? () => setAdding(false) : null);
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
      setAddError(t("contacts.invalidAddress"));
      return;
    }
    if (name.length === 0) {
      setAddError(t("contacts.nameRequired"));
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
        onError: (error) => setAddError(errorText(error)),
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
        title={t("contacts.title")}
        onBack={onBack}
        end={
          <button
            type="button"
            aria-label={t("contacts.add")}
            onClick={() => {
              setAdding((prev) => !prev);
              setAddError(null);
            }}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-foreground hover:bg-hover phone:hit-target"
          >
            <PlusIcon />
          </button>
        }
      />

      {adding ? (
        <div className="flex flex-col gap-2 px-[18px] py-3 phone:px-5">
          <InlineInput
            type="text"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value.slice(0, MAX_NAME_LENGTH))}
            placeholder={t("contacts.name")}
            className="w-full"
          />
          <InlineInput
            type="text"
            value={newAddress}
            onChange={(event) => setNewAddress(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleAdd();
            }}
            placeholder={t("contacts.addressPlaceholder")}
            className="w-full font-mono"
          />
          {addError ? (
            <InlineError as="span">
              {addError}
            </InlineError>
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
              className="text-label font-medium text-muted hover:text-foreground phone:hit-target"
            >
              {t("contacts.cancel")}
            </button>
            <Button type="button" size="sm" disabled={saveContactMutation.isPending} onClick={handleAdd} className="phone:hit-target">
              {saveContactMutation.isPending ? t("contacts.saving") : t("contacts.save")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col px-1 py-2 phone:px-5">
        {contactsQuery.isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : contacts.length === 0 ? (
          <EmptyState
            message={t("contacts.empty")}
            action={
              adding ? null : (
                <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
                  {t("contacts.addFirst")}
                </Button>
              )
            }
          />
        ) : (
          contacts.map((contact) =>
            editingAddress === contact.address ? (
              <div key={contact.address} className="flex items-center gap-2 px-3.5 py-2 phone:px-0">
                <InlineInput
                  type="text"
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value.slice(0, MAX_NAME_LENGTH))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitEdit(contact.address);
                    if (event.key === "Escape") setEditingAddress(null);
                  }}
                  onBlur={() => commitEdit(contact.address)}
                  className="min-w-0 flex-1"
                />
              </div>
            ) : (
              <div key={contact.address} className="flex items-center">
                <div className="min-w-0 flex-1">
                  <AddressRow address={contact.address} name={contact.name} onSelect={() => startEdit(contact)} />
                </div>
                <button
                  type="button"
                  aria-label={t("contacts.delete", { name: contact.name })}
                  onClick={() => handleDelete(contact)}
                  className="mr-2.5 flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-warning"
                >
                  <CloseIcon />
                </button>
              </div>
            ),
          )
        )}
      </div>

      {undo ? (
        <Toast message={t("contacts.deleted", { name: undo.name })} actionLabel={t("contacts.undo")} onAction={handleUndo} />
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

