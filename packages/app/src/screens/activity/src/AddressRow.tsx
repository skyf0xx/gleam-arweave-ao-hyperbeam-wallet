import { AccountAvatar } from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../../../address-identity";
import { useT } from "../../../i18n";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";

/**
 * One address row with a dicebear identicon (`useAddressIdentity().avatarSvg`,
 * same generator as `WalletSwitcherView`) — shared between `SendView`'s
 * "Saved contacts" picker and Settings' Contacts screen so an address
 * looks the same everywhere it's shown. Originally private to
 * `SendView.tsx`; moved here (rather than duplicated) once Contacts needed
 * the same row.
 */
export function AddressRow({
  address,
  name,
  note,
  onSelect,
}: {
  address: string;
  name: string | null;
  /** Plain faint text at the row's end. */
  note?: string;
  onSelect: () => void;
}) {
  const t = useT();
  const identity = useAddressIdentity();
  const avatarSvg = identity.avatarSvg(address);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2 text-left hover:bg-hover"
    >
      <AccountAvatar svgMarkup={avatarSvg} label={name ? t("activity.avatarOf", { name }) : t("activity.addressAvatar")} size={32} />
      {name ? (
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-label font-semibold text-foreground">{name}</span>
          <span className="truncate font-mono text-caption text-faint">{truncateAddress(address, 6)}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">{truncateAddress(address, 6)}</span>
      )}
      {note ? <span className="flex-shrink-0 text-caption text-faint">{note}</span> : null}
    </button>
  );
}
