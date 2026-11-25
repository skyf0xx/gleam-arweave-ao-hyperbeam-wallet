import type { ReactNode } from "react";
import { Button } from "../../primitives/button";
import { ScreenFooter } from "../../primitives/screen-footer";
import { ScreenHeader } from "../../primitives/screen-header";
import { PasswordField } from "./PasswordField";
import { usePasswordEntry } from "./use-password-entry";

export interface PasswordStepProps {
  headerTitle: string;
  heading: string;
  body: string;
  /** Between the intro and the field. */
  notice?: ReactNode;
  passwordLabel: string;
  placeholder: string;
  submitLabel: string;
  submittingLabel: string;
  onBack: () => void;
  onSubmit: (password: string) => void;
  submitting?: boolean;
  serverError?: string;
  /** Whether the submit button shows its working state; defaults to `submitting`. */
  submitBusy?: boolean;
  /** Under the submit button. */
  secondaryAction?: ReactNode;
}

/** A full screen that asks for the vault password and hands it to `onSubmit`. */
export function PasswordStep({
  headerTitle,
  heading,
  body,
  notice,
  passwordLabel,
  placeholder,
  submitLabel,
  submittingLabel,
  onBack,
  onSubmit,
  submitting = false,
  serverError,
  submitBusy = submitting,
  secondaryAction,
}: PasswordStepProps) {
  const { password, setPassword } = usePasswordEntry({ submitting, serverError });

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={headerTitle} onBack={onBack} busy={submitting} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && password.length > 0) onSubmit(password);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">{heading}</h1>
          <p className="text-body leading-relaxed text-muted">{body}</p>
        </div>

        {notice}

        <PasswordField
          label={passwordLabel}
          placeholder={placeholder}
          autoFocus
          autoComplete="current-password"
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
          errorMessage={serverError}
        />

        <ScreenFooter className="mt-8">
          <Button type="submit" disabled={submitting || password.length === 0} aria-busy={submitBusy || undefined}>
            {submitBusy ? submittingLabel : submitLabel}
          </Button>
          {secondaryAction}
        </ScreenFooter>
      </form>
    </div>
  );
}
