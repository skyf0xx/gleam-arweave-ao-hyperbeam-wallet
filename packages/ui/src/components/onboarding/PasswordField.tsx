import * as React from "react";
import { TextField, type TextFieldProps } from "../../primitives/text-field";
import { cn } from "../../primitives/cn";
import { useUiLabels } from "../../labels";

/**
 * Password input with a reveal toggle and (optionally) a caps-lock
 * hint — a thin wrapper around the shared `TextField` primitive rather
 * than a duplicate of its markup. `TextField` owns the border/error-row
 * shape and is reused as-is; the label is re-rendered here (rather than
 * left to `TextField`) so the reveal-toggle button can be positioned
 * directly against the `<input>` regardless of whether a label is
 * present, without measuring layout at runtime.
 */
export interface PasswordFieldProps extends Omit<TextFieldProps, "type" | "label"> {
  label?: string;
  /** Overrides the hint the field shows from its own Caps Lock detection. */
  capsLockOn?: boolean;
  /** Accessible names and hint text; English unless the caller passes its own. */
  showLabel?: string;
  hideLabel?: string;
  capsLockLabel?: string;
}

export const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ label, capsLockOn, showLabel, hideLabel, capsLockLabel, id, className, onKeyUp, ...props }, ref) => {
    const labels = useUiLabels();
    const [revealed, setRevealed] = React.useState(false);
    const [capsLockDetected, setCapsLockDetected] = React.useState(false);
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {label ? (
          <label htmlFor={inputId} className="text-caption font-semibold text-muted">
            {label}
          </label>
        ) : null}
        <div className="relative">
          <TextField
            ref={ref}
            id={inputId}
            type={revealed ? "text" : "password"}
            // Edge and some Chromium builds draw their own reveal eye beside ours.
            className="pr-10 phone:pr-12 [&::-ms-clear]:hidden [&::-ms-reveal]:hidden"
            {...props}
            onKeyUp={(event) => {
              setCapsLockDetected(event.getModifierState?.("CapsLock") ?? false);
              onKeyUp?.(event);
            }}
          />
          <button
            type="button"
            aria-label={revealed ? (hideLabel ?? labels.hidePassword) : (showLabel ?? labels.showPassword)}
            aria-pressed={revealed}
            onClick={() => setRevealed((value) => !value)}
            className="absolute right-2 top-0 flex h-11 w-7 flex-shrink-0 phone:right-0 phone:w-11 items-center justify-center text-faint hover:text-muted"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xs hover:bg-hover">
              <EyeIcon />
            </span>
          </button>
        </div>
        {(capsLockOn ?? capsLockDetected) ? (
          <div className="flex items-center gap-1.5 text-caption text-muted">
            <CapsLockIcon />
            <span>{capsLockLabel ?? labels.capsLockOn}</span>
          </div>
        ) : null}
      </div>
    );
  },
);
PasswordField.displayName = "PasswordField";

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CapsLockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 4 11h5v10h6V11h5L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
