import * as React from "react";
import { cn } from "./cn";

/**
 * Labeled text input with an inline validation message (shared.css
 * `.field-error`, repeated across send-flow.html's address/amount
 * fields and onboarding.html's password fields). brand/voice.md calls
 * for "inline validation message, not a summary error block" — this
 * component is the one place that pattern is implemented, so no screen
 * hand-rolls its own error-row markup.
 *
 * Password-specific behavior (reveal toggle, caps-lock notice) stays in
 * `components/onboarding/PasswordField.tsx` rather than being folded in
 * here — this primitive is the generic labeled-input shape every other
 * field variant (address, amount, search) composes from.
 */
export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  errorMessage?: string;
  hint?: React.ReactNode;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, errorMessage, hint, id, className, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const errorId = errorMessage ? `${inputId}-error` : undefined;

    return (
      <div className="flex flex-col gap-2">
        {label ? (
          <div className="flex items-center justify-between">
            <label htmlFor={inputId} className="text-caption font-semibold text-muted">
              {label}
            </label>
            {hint}
          </div>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorId}
          className={cn(
            "w-full rounded-md border border-line bg-background px-3.5 py-3 text-body text-foreground placeholder:text-faint focus:border-foreground focus:outline-none",
            errorMessage && "border-warning",
            className,
          )}
          {...props}
        />
        {errorMessage ? (
          <div id={errorId} role="alert" className="flex items-start gap-1.5 text-caption leading-snug text-warning">
            <ErrorIcon />
            <span>{errorMessage}</span>
          </div>
        ) : null}
      </div>
    );
  },
);
TextField.displayName = "TextField";

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-[1px] flex-shrink-0">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
