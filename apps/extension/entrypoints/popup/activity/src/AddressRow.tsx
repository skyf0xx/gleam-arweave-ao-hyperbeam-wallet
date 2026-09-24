import { useMemo } from "react";
import { AccountAvatar } from "@gleam/ui/src/components/wallet/index.ts";
import { generateAccountAvatarSvg } from "../../main-screen/src/generateAccountAvatar";
import { truncateAddress } from "../../main-screen/src/formatWinston";

/**
 * One address row with a dicebear identicon (`generateAccountAvatarSvg`,
 * same generator as `WalletSwitcherView`) — shared between `SendView`'s
 * "Saved addresses" picker and Settings' Contacts screen so an address
 * looks the same everywhere it's shown. Originally private to
 * `SendView.tsx`; moved here (rather than duplicated) once Contacts needed
 * the same row.
 */
export function AddressRow({ address, name, onSelect }: { address: string; name: string | null; onSelect: () => void }) {
  const avatarSvg = useMemo(() => generateAccountAvatarSvg(address), [address]);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left last:border-b-0 hover:bg-mist"
    >
      <AccountAvatar svgMarkup={avatarSvg} label={name ? `${name} avatar` : "Address avatar"} size={32} className="rounded-2xl" />
      {name ? (
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-label font-semibold text-foreground">{name}</span>
          <span className="truncate font-mono text-caption text-faint">{truncateAddress(address)}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">{truncateAddress(address)}</span>
      )}
    </button>
  );
}
