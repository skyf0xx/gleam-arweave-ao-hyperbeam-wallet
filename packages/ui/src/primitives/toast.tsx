import { cn } from "./cn";

/**
 * A single transient bar pinned to the bottom of the current screen, for a
 * lightweight confirmation that offers one reversing action — e.g. "Contact
 * deleted" + "Undo" after Settings' Contacts screen removes a row with no
 * confirmation dialog. Deliberately not a stack/queue: callers hold at most
 * one toast in local state (`message: string | null`) and replace it
 * outright on the next dismissal-worthy action, matching how sparingly
 * DESIGN.md wants transient UI used.
 */
export interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function Toast({ message, actionLabel, onAction, className }: ToastProps) {
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto absolute inset-x-3.5 bottom-3.5 flex items-center justify-between gap-3 rounded-lg bg-foreground px-3.5 py-3 text-label text-background shadow-lg",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="flex-shrink-0 font-semibold underline-offset-2 hover:underline">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
