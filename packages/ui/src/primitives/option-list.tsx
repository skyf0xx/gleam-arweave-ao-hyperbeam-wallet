import { useId, type ReactNode } from "react";
import { CheckIcon } from "./copy-icons";

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
      <div className="pb-1.5 text-caption font-semibold uppercase tracking-wide text-muted phone:pb-0.5">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * One choice in an `OptionSection`: a title, an optional line saying what
 * it takes or does, an optional current value, and a chevron that marks it
 * as a step forward. A disabled row drops the chevron. Leave the
 * description out when the title already says it ("Contacts").
 */
export interface OptionRowProps {
  title: string;
  description?: string;
  /** The setting's current value, shown before the chevron. */
  value?: string;
  /** How many items the row leads to, as a small round count. Left out at zero. */
  count?: number;
  onClick?: () => void;
  disabled?: boolean;
  /** Opens a page outside Gleam: an arrow out replaces the chevron. */
  external?: boolean;
}

export function OptionRow({
  title,
  description,
  value,
  count,
  onClick,
  disabled = false,
  external = false,
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
      aria-describedby={description ? descriptionId : undefined}
      className="-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-2.5 rounded-lg px-3 py-3.5 text-left hover:enabled:bg-hover phone:min-h-[3.75rem] phone:py-2.5 phone:active:enabled:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={titleId} className="text-label font-semibold text-foreground">
          {title}
        </span>
        {description ? (
          <span id={descriptionId} className="text-caption text-muted">
            {description}
          </span>
        ) : null}
      </span>
      {value ? <span className="flex-shrink-0 text-label text-muted">{value}</span> : null}
      {count ? (
        <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-mist px-1.5 text-caption font-semibold tabular-nums text-muted">
          {count}
        </span>
      ) : null}
      {disabled ? null : (
        <span aria-hidden="true" className="gleam-chevron flex-shrink-0 text-faint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d={external ? "M7 17 17 7M8 7h9v9" : "m9 6 6 6-6 6"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </button>
  );
}

export interface ChoiceRowProps {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /**
   * One of a `radiogroup` (the default): the check holds its width so rows
   * line up. Off, the row is a plain button that shows a check only when
   * selected.
   */
  radio?: boolean;
  /** Replaces the check drawn when selected. */
  checkIcon?: ReactNode;
  children: ReactNode;
}

/** One pick in a list where the chosen row is marked with a check. */
export function ChoiceRow({ selected, onSelect, disabled, radio = true, checkIcon, children }: ChoiceRowProps) {
  const check = checkIcon ?? <CheckIcon size={16} />;
  return (
    <button
      type="button"
      role={radio ? "radio" : undefined}
      aria-checked={radio ? selected : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={
        radio
          ? "-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-3 text-left phone:py-3.5 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
          : "-mx-3 flex w-[calc(100%+1.5rem)] items-center gap-2.5 rounded-lg px-3 py-3.5 text-left hover:bg-hover disabled:opacity-60"
      }
    >
      {children}
      {radio ? (
        <span aria-hidden="true" className="w-4 flex-shrink-0 text-foreground">
          {selected ? check : null}
        </span>
      ) : selected ? (
        <span aria-hidden="true" className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-foreground">
          {check}
        </span>
      ) : null}
    </button>
  );
}
