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
  /** Shows a "Change" button, for a card standing in for an address field. */
  onEdit?: () => void;
  className?: string;
}

/** Who you're sending to: the address's avatar, its name if known, and the chunked address. */
export function RecipientCard({ address, name, avatarSvg, emphasisPick, tone = "default", onEdit, className }: RecipientCardProps) {
  const showNameLine = name !== undefined || onEdit !== undefined;
  return (
    <div className={cn("flex items-start gap-3 rounded-md border border-line bg-background px-3.5 py-3", className)}>
      <AccountAvatar svgMarkup={avatarSvg} label={name ? `${name} avatar` : "Address avatar"} size={32} />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", !showNameLine && "self-center")}>
        {showNameLine ? (
          <div className="flex min-h-4.5 items-center justify-between gap-2">
            <span className={cn("truncate text-label font-semibold", name ? "text-foreground" : "text-muted")}>
              {name ?? (name === null ? "New address" : "")}
            </span>
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-caption font-medium text-muted hover:bg-mist hover:text-foreground"
              >
                Change
              </button>
            ) : null}
          </div>
        ) : null}
        <MemorableAddress address={address} emphasisPick={emphasisPick} tone={tone} />
      </div>
    </div>
  );
}
