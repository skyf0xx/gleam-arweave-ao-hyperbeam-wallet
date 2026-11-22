import { useId } from "react";
import { cn } from "./cn";

/**
 * Rows for a list of settings that change in place, without opening
 * another screen: `SelectRow` picks one of a few values, `ToggleRow` turns
 * a setting on or off. They line up with `OptionRow`, which opens one.
 *
 * Give a `SelectRow` option a `description` when its label alone doesn't
 * say what it changes ("Compact"); the row shows the selected option's,
 * so it updates as the choice does. Leave it out when the label says it.
 */
export interface SelectRowOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function SelectRow<T extends string>({
  title,
  value,
  options,
  disabled,
  onChange,
}: {
  title: string;
  value: T;
  options: SelectRowOption<T>[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const descriptionId = useId();
  const description = options.find((option) => option.value === value)?.description;
  return (
    <div className="flex w-full items-center justify-between gap-3 py-3.5">
      <span className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-label font-semibold text-foreground">
          {title}
        </label>
        {description ? (
          <span id={descriptionId} className="text-caption text-muted">
            {description}
          </span>
        ) : null}
      </span>
      {/* Reads like the value on an option row: no box, just the choice and a chevron. The native
          arrow ignores padding, so it's hidden and drawn here with room on the right. */}
      <div className="relative shrink-0">
        <select
          id={id}
          aria-describedby={description ? descriptionId : undefined}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as T)}
          className="cursor-pointer appearance-none rounded-md bg-transparent py-1 pl-2 pr-6 text-right text-label text-muted hover:enabled:bg-hover hover:enabled:text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-foreground disabled:cursor-default disabled:opacity-60"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-faint"
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onToggle,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 py-3.5 text-left disabled:opacity-60"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-title`} className="text-label font-semibold text-foreground">
          {title}
        </span>
        {description ? (
          <span id={`${id}-description`} className="text-caption text-muted">
            {description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-foreground" : "bg-line",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </button>
  );
}

/** Picks one of two or three short values with a single tap, all of them in view. */
export function SegmentedRow<T extends string>({
  title,
  value,
  options,
  disabled,
  onChange,
}: {
  title: string;
  value: T;
  options: SelectRowOption<T>[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const titleId = useId();
  return (
    <div className="flex w-full items-center justify-between gap-3 py-2.5 phone:min-h-[3.75rem]">
      <span id={titleId} className="text-label font-semibold text-foreground">
        {title}
      </span>
      <div role="radiogroup" aria-labelledby={titleId} className="flex shrink-0 rounded-lg bg-mist p-0.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => {
                if (!selected) onChange(option.value);
              }}
              className={cn(
                "rounded-md px-3 py-1 text-caption font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:cursor-default",
                selected ? "gleam-frost-chip bg-background text-foreground shadow-sm" : "text-muted hover:enabled:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
