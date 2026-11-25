import { useEffect, useRef, useState } from "react";
import { RecipientCard, RecipientWarning } from "@gleam/ui/src/components/wallet/index.ts";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { InlineInput } from "@gleam/ui/src/primitives/inline-input.tsx";
import { QrScanIcon } from "@gleam/ui/src/primitives/icons.tsx";
import { useAddressIdentity } from "../../../address-identity";
import { useT } from "../../../i18n";
import { usePlatform } from "../../../app-platform/context";
import { addressFromQr, QrScanError } from "../../../app-platform/qr-scanner";
import { AddressRow } from "../../activity";
import type { NamedAddress } from "./namedAddresses";
import { recipientSchema } from "./sendFormSchema";

const SUGGESTION_LIMIT = 4;

/**
 * The "To" field: address input and the quiet "Save this address" line.
 * While the input has focus, a short list of named addresses drops down
 * under it, filtered by what's typed, ending in a "Saved contacts" link to
 * the full picker. Once a valid address loses focus, the input
 * gives way to a card with the address's avatar and chunked form, so it
 * can be checked at a glance before Review send. "Change" brings the
 * input back.
 */
export function RecipientField({
  recipient,
  recipientError,
  knownName,
  emphasisPick,
  lookalikeOf,
  suggestions,
  onChangeRecipient,
  onBlurRecipient,
  onOpenSavedAddresses,
  hideSaveOption,
  showSaveAddress,
  saveAddressName,
  onToggleSaveAddress,
  onChangeSaveAddressName,
  onConfirmSaveAddress,
  savingAddress,
}: {
  recipient: string;
  recipientError: string | undefined;
  /** The saved contact's or own wallet's name for `recipient`, if it is one. */
  knownName: string | undefined;
  emphasisPick: number | null;
  /** A trusted address this one imitates, warned about while still composing. */
  lookalikeOf: string | null;
  /** Named addresses for the focus dropdown: contacts, then your wallets, each most recently sent to first (`namedSuggestions`). */
  suggestions: NamedAddress[];
  onChangeRecipient: (recipient: string) => void;
  onBlurRecipient: () => void;
  onOpenSavedAddresses: () => void;
  /** True when the current recipient is already a saved contact or one of your own wallets. */
  hideSaveOption: boolean;
  showSaveAddress: boolean;
  saveAddressName: string;
  onToggleSaveAddress: () => void;
  onChangeSaveAddressName: (name: string) => void;
  onConfirmSaveAddress: () => void;
  savingAddress: boolean;
}) {
  const t = useT();
  const { capabilities, qrScanner } = usePlatform();
  const [editing, setEditing] = useState<"no" | "focused" | "refocus">("no");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | undefined>();
  // A scan fills the field without focusing it, so no blur will validate it.
  const [validateScan, setValidateScan] = useState(false);
  useEffect(() => {
    if (!validateScan) return;
    setValidateScan(false);
    onBlurRecipient();
  }, [validateScan, onBlurRecipient]);
  const address = recipientSchema.safeParse(recipient).data;
  const identity = useAddressIdentity();
  const avatarSvg = address ? identity.avatarSvg(address) : undefined;
  const showCard = editing === "no" && !recipientError && address !== undefined && avatarSvg !== undefined;
  // Picking a row swaps the input for the card; a blur fired on the way
  // out still carries the old text and would flag it as invalid.
  const pickedRef = useRef(false);
  const query = recipient.trim().toLowerCase();
  // Also the only way into the full picker, so it opens even with nothing to suggest.
  const showDropdown = editing === "focused" && address === undefined;
  const shownSuggestions = showDropdown
    ? suggestions
        .filter(
          (candidate) =>
            query.length === 0 || candidate.name.toLowerCase().includes(query) || candidate.address.toLowerCase().includes(query),
        )
        .slice(0, SUGGESTION_LIMIT)
    : [];

  async function scan() {
    setScanning(true);
    setScanError(undefined);
    try {
      const payload = await qrScanner.scan();
      if (payload === null) return;
      onChangeRecipient(addressFromQr(payload));
      setValidateScan(true);
    } catch (error) {
      setScanError(
        error instanceof QrScanError && error.reason === "permission-denied"
          ? t("send.scanCameraOff")
          : t("send.scanFailed"),
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label font-semibold text-muted">{t("send.to")}</span>
        {capabilities.qrScanner ? (
          <button
            type="button"
            aria-label={t("send.scanQr")}
            disabled={scanning}
            onClick={() => void scan()}
            // 44px target without growing the label row.
            className="-my-3 -mr-3 flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground disabled:opacity-50"
          >
            <QrScanIcon />
          </button>
        ) : null}
      </div>
      {showCard ? (
        <RecipientCard
          address={address}
          name={knownName ?? null}
          avatarSvg={avatarSvg}
          emphasisPick={emphasisPick}
          diffAgainst={lookalikeOf ?? undefined}
          onEdit={() => setEditing("refocus")}
        />
      ) : (
        <div className="relative">
          <InlineInput
            type="text"
            spellCheck={false}
            aria-label={t("send.recipientAddress")}
            autoFocus={editing === "refocus"}
            value={recipient}
            onChange={(event) => onChangeRecipient(event.target.value)}
            onFocus={() => {
              pickedRef.current = false;
              setEditing("focused");
            }}
            onBlur={() => {
              setEditing("no");
              if (!pickedRef.current) onBlurRecipient();
            }}
            placeholder={t("send.pasteAddress")}
            className="w-full py-3 font-mono leading-relaxed"
          />
          {showDropdown ? (
            <div
              role="listbox"
              aria-label={t("send.savedContacts")}
              // Keeps focus in the input, so a click lands before the blur closes the list.
              onMouseDown={(event) => event.preventDefault()}
              // In flow on the phone: floating, it sits under the pinned footer and adds
              // no scroll height, so with the keyboard up its rows can't be reached.
              className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden phone:static rounded-md bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.10),0_1px_3px_rgba(0,0,0,0.06)]"
            >
              {shownSuggestions.length > 0 ? (
                <div className="py-1">
                  {shownSuggestions.map((candidate) => (
                    <AddressRow
                      key={candidate.address}
                      address={candidate.address}
                      name={candidate.name}
                      note={candidate.own ? t("send.yours") : undefined}
                      onSelect={() => {
                        pickedRef.current = true;
                        onChangeRecipient(candidate.address);
                        setEditing("no");
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={onOpenSavedAddresses}
                className="flex w-full items-center justify-between px-3.5 py-3 text-left text-label font-medium text-muted hover:bg-hover hover:text-foreground"
              >
                {t("send.savedContacts")}
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      )}
      {recipientError ? (
        <InlineError size="label" as="div">
          {recipientError}
        </InlineError>
      ) : null}
      {scanError ? (
        <InlineError size="label" as="div">
          {scanError}
        </InlineError>
      ) : null}
      {lookalikeOf ? (
        <RecipientWarning
          firstTime={false}
          recipient={recipient}
          lookalikeOf={lookalikeOf}
          lookalikeAvatarSvg={identity.avatarSvg(lookalikeOf)}
          emphasisPick={emphasisPick}
        />
      ) : null}
      {/* Saving a lookalike would make the fake a trusted contact. */}
      {!recipientError && !lookalikeOf && recipientSchema.safeParse(recipient).success && !hideSaveOption ? (
        <SaveAddressInline
          expanded={showSaveAddress}
          name={saveAddressName}
          saving={savingAddress}
          onToggle={onToggleSaveAddress}
          onChangeName={onChangeSaveAddressName}
          onConfirm={onConfirmSaveAddress}
        />
      ) : null}
    </div>
  );
}

/**
 * The quiet "Save this address" affordance under the recipient field
 * (compose) and under the success message (`SuccessStep`) — one checkbox
 * that reveals a blank name input in place, no modal. Shown only for a
 * full, valid, not-yet-saved address (callers gate on `contact`/`isSaved`
 * before rendering this).
 */
function SaveAddressInline({
  expanded,
  name,
  saving,
  onToggle,
  onChangeName,
  onConfirm,
}: {
  expanded: boolean;
  name: string;
  saving: boolean;
  onToggle: () => void;
  onChangeName: (name: string) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      {/* Keeps focus in the recipient input: its blur swaps in the shorter card, which moves this checkbox out from under the click. */}
      <label onMouseDown={(event) => event.preventDefault()} className="flex w-fit items-center gap-2 text-label text-muted phone:min-h-11 phone:gap-2.5">
        <input type="checkbox" checked={expanded} onChange={onToggle} className="h-3.5 w-3.5 accent-foreground phone:h-5 phone:w-5" />
        {t("send.saveThisAddress")}
      </label>
      {expanded ? (
        <div className="flex items-center gap-2">
          <InlineInput
            type="text"
            autoFocus
            value={name}
            onChange={(event) => onChangeName(event.target.value.slice(0, 32))}
            onKeyDown={(event) => {
              if (event.key === "Enter") onConfirm();
            }}
            placeholder={t("send.enterAddressName")}
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            disabled={name.trim().length === 0 || saving}
            onClick={onConfirm}
            className="flex-shrink-0 text-label font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-40"
          >
            {saving ? t("send.saving") : t("send.save")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
