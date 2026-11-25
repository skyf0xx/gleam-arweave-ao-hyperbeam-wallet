import { useState, type ReactNode } from "react";
import type { Contact, RuntimePort, WalletSummary } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { SearchField } from "@gleam/ui/src/primitives/search-field.tsx";
import { EmptyState } from "@gleam/ui/src/components/wallet/index.ts";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { AddressRow } from "../../activity";
import { useActivity } from "../../activity";
import { recentSendRecipients } from "./namedAddresses";
import { SkeletonPickerRow } from "./SkeletonPickerRow";

/**
 * Saved contacts picker, in three sections: saved contacts (`useContacts`,
 * vault-wide), "Your wallets" (`useOtherWallets`, never the active one),
 * then the latest few addresses sent to that have no
 * name. Each section skips addresses an earlier one already shows. The
 * search field filters every section by name or address, and searches
 * every recent address rather than just the few listed. Rows show the
 * same identicon as everywhere else an address appears.
 */
export function SavedAddressesStep({
  runtime,
  wallet,
  contacts,
  contactsLoading,
  otherWallets,
  otherWalletsLoading,
  onSelect,
  onEditContacts,
  onBack,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  contacts: Contact[];
  contactsLoading: boolean;
  otherWallets: WalletSummary[];
  otherWalletsLoading: boolean;
  onSelect: (recipient: string) => void;
  /** Opens the contact list to add, rename or delete; omitted where the picker can't host it. */
  onEditContacts?: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const activityQuery = useActivity(runtime, wallet.address);

  const shownAddresses = new Set([...contacts.map((c) => c.address), ...otherWallets.map((w) => w.address)]);
  const recentOnly = activityQuery.data
    ? recentSendRecipients(activityQuery.data).filter((address) => !shownAddresses.has(address))
    : [];

  const query = filter.trim().toLowerCase();
  const matches = (name: string | null, address: string) =>
    query.length === 0 || (name?.toLowerCase().includes(query) ?? false) || address.toLowerCase().includes(query);

  const filteredContacts = contacts.filter((contact) => matches(contact.name, contact.address));
  const filteredWallets = otherWallets.filter((candidate) => matches(candidate.name, candidate.address));
  const filteredRecent = recentOnly
    .filter((address) => matches(null, address))
    .slice(0, query.length > 0 ? undefined : RECENT_LIMIT);

  const loading = contactsLoading || otherWalletsLoading || activityQuery.isLoading;
  const isEmpty =
    !loading && filteredContacts.length === 0 && filteredWallets.length === 0 && filteredRecent.length === 0;

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label={t("send.savedContacts")}>
      <ScreenHeader
        title={t("send.savedContacts")}
        onBack={onBack}
        end={
          onEditContacts ? (
            <button
              type="button"
              aria-label={t("send.editContacts")}
              onClick={onEditContacts}
              className="rounded-md px-2 py-1 text-label font-semibold text-muted hover:bg-hover hover:text-foreground phone:hit-target"
            >
              {t("send.edit")}
            </button>
          ) : undefined
        }
      />
      <SearchField
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("send.searchPlaceholder")}
        className="px-[18px] pb-1 pt-3 phone:px-5"
      />
      <div className="flex flex-1 flex-col px-1 py-2 phone:px-5">
        {activityQuery.isError ? (
          <InlineError size="label" as="div" className="px-4 py-3 phone:px-0">
            {errorText(activityQuery.error)}
          </InlineError>
        ) : loading ? (
          <>
            <SkeletonPickerRow />
            <SkeletonPickerRow />
          </>
        ) : isEmpty ? (
          <EmptyState
            message={
              query.length > 0
                ? t("send.noMatching")
                : t("send.noSavedYet")
            }
          />
        ) : (
          <>
            {filteredContacts.length > 0 ? (
              <PickerSection label={t("send.contacts")}>
                {filteredContacts.map((contact) => (
                  <AddressRow key={contact.address} address={contact.address} name={contact.name} onSelect={() => onSelect(contact.address)} />
                ))}
              </PickerSection>
            ) : null}
            {filteredWallets.length > 0 ? (
              <PickerSection label={t("send.yourWallets")}>
                {filteredWallets.map((candidate) => (
                  <AddressRow key={candidate.address} address={candidate.address} name={candidate.name} onSelect={() => onSelect(candidate.address)} />
                ))}
              </PickerSection>
            ) : null}
            {filteredRecent.length > 0 ? (
              <PickerSection label={t("send.recent")}>
                {filteredRecent.map((address) => (
                  <AddressRow key={address} address={address} name={null} onSelect={() => onSelect(address)} />
                ))}
              </PickerSection>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function PickerSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <div className="px-3.5 pb-1.5 pt-3 text-caption font-semibold uppercase tracking-wide text-muted phone:px-0">{label}</div>
      {children}
    </section>
  );
}

/** Older recipients are a search away; the list itself stays short. */
const RECENT_LIMIT = 5;
