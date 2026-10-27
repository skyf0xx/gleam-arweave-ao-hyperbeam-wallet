import { useId, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * A labelled group of `OptionRow`s, for screens where the user picks one
 * path out of several. The label names what the rows have in common, so
 * the reader compares groups first and rows second.
 */
export interface OptionSectionProps {
  title: string;
  children: ReactNode;
}

export function OptionSection({ title, children }: OptionSectionProps) {
  return (
    <section aria-label={title}>
      <div className="border-b border-line pb-2 text-label font-semibold uppercase tracking-[0.04em] text-muted phone:border-b-0 phone:pb-0">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * One choice in an `OptionSection`: a title, a line saying what it takes
 * or does, an optional current value, and a chevron that marks it as a
 * step forward. A disabled row drops the chevron.
 */
export interface OptionRowProps {
  title: string;
  description: string;
  /** The setting's current value, shown before the chevron. */
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Draws a line between rows. Turn off for plain lists of settings. */
  divided?: boolean;
}

export function OptionRow({
  title,
  description,
  value,
  onClick,
  disabled = false,
  divided = true,
}: OptionRowProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onClick={onClick}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "flex w-full items-center gap-2.5 py-3.5 text-left hover:enabled:bg-mist phone:min-h-[3.75rem] phone:py-2.5 phone:active:enabled:bg-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-50",
        divided && "border-b border-line last:border-b-0 phone:border-b-0",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={titleId} className="text-label font-semibold text-foreground">
          {title}
        </span>
        <span id={descriptionId} className="text-caption text-muted">
          {description}
        </span>
      </span>
      {value ? <span className="flex-shrink-0 text-label text-muted">{value}</span> : null}
      {disabled ? null : (
        <span aria-hidden="true" className="flex-shrink-0 text-faint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </button>
  );
}
