import { cn } from "./cn";
import { CheckIcon, CopyIcon } from "./copy-icons";

export interface CopyButtonProps {
  copied: boolean;
  onCopy: () => void;
  label: string;
  title: string;
  iconSize?: number;
  /**
   * Shows only on hover or focus of a `group` parent (always on a phone) and
   * turns green once copied; `tone` is its idle colour.
   */
  reveal?: boolean;
  tone?: "muted" | "faint";
  className?: string;
}

/** The icon button that copies a value and shows a check for a moment after. */
export function CopyButton({ copied, onCopy, label, title, iconSize, reveal = false, tone = "faint", className }: CopyButtonProps) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label}
      title={title}
      className={cn(
        className,
        reveal && (copied ? "text-positive opacity-100" : [tone === "muted" ? "text-muted" : "text-faint", "opacity-0 hover:text-foreground"]),
      )}
    >
      {copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
    </button>
  );
}
