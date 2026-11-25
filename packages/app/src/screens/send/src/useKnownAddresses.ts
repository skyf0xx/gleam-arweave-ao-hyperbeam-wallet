import type { Contact, RuntimePort, WalletSummary } from "@gleam/core";
import { useContacts, useSaveContact } from "../../activity/src/useContacts";
import { useOtherWallets } from "../../activity/src/useOtherWallets";

/**
 * The addresses a send already knows: the vault-wide contacts and the
 * vault's other wallets. A recipient in either counts as known, so Review
 * names it and Success doesn't offer to save it again.
 */
export function useKnownAddresses(runtime: RuntimePort, walletId: string) {
  const contactsQuery = useContacts(runtime);
  const otherWalletsQuery = useOtherWallets(runtime, walletId);
  const saveContactMutation = useSaveContact(runtime);
  const contacts = contactsQuery.data ?? [];
  const otherWallets = otherWalletsQuery.data ?? [];

  const contactFor = (address: string): Contact | undefined => contacts.find((candidate) => candidate.address === address);
  const ownWalletFor = (address: string): WalletSummary | undefined => otherWallets.find((candidate) => candidate.address === address);

  return {
    contacts,
    otherWallets,
    contactFor,
    ownWalletFor,
    knownNameFor: (address: string): string | undefined => (contactFor(address) ?? ownWalletFor(address))?.name,
    isKnown: (address: string): boolean => contactFor(address) !== undefined || ownWalletFor(address) !== undefined,
    saveContactMutation,
    /** The lists the saved-addresses step shows. */
    listProps: {
      contacts,
      contactsLoading: contactsQuery.isLoading,
      otherWallets,
      otherWalletsLoading: otherWalletsQuery.isLoading,
    },
    /** What the success step needs to offer saving the recipient. */
    successSaveProps: (recipient: string) => ({
      isSaved: contactFor(recipient) !== undefined || ownWalletFor(recipient) !== undefined,
      onSaveAddress: (name: string) => saveContactMutation.mutate({ address: recipient, name }),
      saving: saveContactMutation.isPending,
    }),
  };
}
