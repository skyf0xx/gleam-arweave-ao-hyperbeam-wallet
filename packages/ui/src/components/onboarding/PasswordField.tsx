import * as React from "react";
import { cn } from "../../primitives/cn";

/**
 * Password input with a reveal toggle and an inline validation message
 * (onboarding.html's `.password-field` + `.field-error`, unlock-screen's
 * identical structure) — brand/voice.md's "inline validation message, not
 * a summary error block" (TODO.md 1.2).
 */
export interface PasswordFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  errorMessage?: string;
  capsLockOn?: boolean;
}

export const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ label, errorMessage, capsLockOn, id, className, ...props }, ref) => {
    const [revealed, setRevealed] = React.useState(false);
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = errorMessage ? `${inputId}-error` : undefined;

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <label htmlFor={inputId} className="text-xs font-semibold text-[#737373]">
          {label}
        </label>
        <div className="relative flex items-center">
          <input
            ref={ref}
            id={inputId}
            type={revealed ? "text" : "password"}
            aria-invalid={Boolean(errorMessage)}
            aria-describedby={errorId}
            className={cn(
              "w-full rounded-[9px] border border-[#e5e5e5] bg-white px-[14px] py-[13px] pr-10 text-sm text-[#111111] placeholder:text-[#a3a3a3] focus:border-[#111111] focus:outline-none",
              errorMessage && "border-[#ff1717]",
            )}
            {...props}
          />
          <button
            type="button"
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            onClick={() => setRevealed((value) => !value)}
            className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-[7px] text-[#a3a3a3] hover:bg-[#f5f5f5] hover:text-[#737373]"
          >
            <EyeIcon />
          </button>
        </div>
        {capsLockOn ? (
          <div className="flex items-center gap-1.5 text-xs text-[#737373]">
            <CapsLockIcon />
            <span>Caps Lock is on</span>
          </div>
        ) : null}
        {errorMessage ? (
          <div
            id={errorId}
            role="alert"
            className="flex items-start gap-1.5 text-xs leading-snug text-[#ff1717]"
          >
            <ErrorIcon />
            <span>{errorMessage}</span>
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
      <path
        d="M12 3 4 11h5v10h6V11h5L12 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mt-[1px] flex-shrink-0"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
