import { cn } from "../../primitives/cn";
import { AccountAvatar } from "./AccountAvatar";
import { MemorableAddress } from "./MemorableAddress";

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
  /** Makes the whole card a button, for a card standing in for an address field. */
  onEdit?: () => void;
  className?: string;
}

/**
 * Who you're sending to: the address's avatar, its name if known, and the
 * chunked address. With `onEdit` the whole card is the button that brings
 * the address field back, so it's built from spans (a button holds only
 * phrasing content).
 */
export function RecipientCard({ address, name, avatarSvg, emphasisPick, tone = "default", onEdit, className }: RecipientCardProps) {
  const body = (
    <>
      <AccountAvatar svgMarkup={avatarSvg} label={name ? `${name} avatar` : "Address avatar"} size={40} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {name !== undefined ? (
          <span className={cn("truncate text-label font-semibold", name ? "text-foreground" : "text-muted")}>
            {name ?? "New address"}
          </span>
        ) : null}
        {/* Pulls the padded chunks back so the address lines up with the name. */}
        <MemorableAddress address={address} emphasisPick={emphasisPick} tone={tone} className="-ml-[0.35ch]" />
      </span>
    </>
  );
  const frame = "flex w-full items-center gap-3.5 rounded-md border border-line bg-background py-3 pl-3.5 pr-3 text-left";

  if (onEdit) {
    return (
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Change recipient${name ? `, ${name}` : ""}`}
        className={cn(frame, "transition-colors hover:border-faint focus-visible:border-foreground focus-visible:outline-none", className)}
      >
        {body}
      </button>
    );
  }
  return <div className={cn(frame, className)}>{body}</div>;
}
