import { cn } from "../../primitives/cn";
import { AccountAvatar } from "./AccountAvatar";
import { MemorableAddress } from "./MemorableAddress";
import { useUiLabels } from "../../labels";

export interface RecipientCardProps {
  address: string;
  /**
   * A saved contact's or one of the user's wallets' name; `null` when the
   * address is neither ("New address"). Leave it out where that isn't
   * known, and the card shows no name line.
   */
  name?: string | null;
  avatarSvg: string;
  emphasisPick: number | null;
  tone?: "default" | "confirm";
  /** The address this one imitates; differing chunks are marked. */
  diffAgainst?: string;
  /** Makes the whole card a button, for a card standing in for an address field. */
  onEdit?: () => void;
  /** Visible and accessible text; English unless the caller passes its own. */
  labels?: RecipientCardLabels;
  className?: string;
}

export interface RecipientCardLabels {
  newAddress: string;
  avatar: (name: string) => string;
  addressAvatar: string;
  change: (name: string | null) => string;
}

/**
 * Who you're sending to: the address's avatar, its name if known, and the
 * chunked address. With `onEdit` the whole card is the button that brings
 * the address field back, so it's built from spans (a button holds only
 * phrasing content).
 */
export function RecipientCard({
  address,
  name,
  avatarSvg,
  emphasisPick,
  tone = "default",
  diffAgainst,
  onEdit,
  labels: labelsProp,
  className,
}: RecipientCardProps) {
  const contextLabels = useUiLabels();
  const labels = labelsProp ?? contextLabels.recipientCard;
  const body = (
    <>
      <AccountAvatar svgMarkup={avatarSvg} label={name ? labels.avatar(name) : labels.addressAvatar} size={40} className="phone:h-8! phone:w-8!" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {name !== undefined ? (
          <span className={cn("truncate text-label font-semibold", name ? "text-foreground" : "text-muted")}>
            {name ?? labels.newAddress}
          </span>
        ) : null}
        {/* Pulls the padded chunks back so the address lines up with the name. */}
        <MemorableAddress address={address} emphasisPick={emphasisPick} tone={tone} diffAgainst={diffAgainst} className="-ml-[0.35ch] phone:-ml-[0.25ch]" />
      </span>
    </>
  );
  const frame = "flex w-full items-center gap-3.5 phone:gap-3 rounded-md bg-foreground/[0.03] py-3 pl-3.5 pr-3 text-left phone:pl-3";

  if (onEdit) {
    return (
      <button
        type="button"
        onClick={onEdit}
        aria-label={labels.change(name ?? null)}
        className={cn(frame, "transition-colors hover:bg-foreground/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground", className)}
      >
        {body}
      </button>
    );
  }
  return <div className={cn(frame, className)}>{body}</div>;
}
