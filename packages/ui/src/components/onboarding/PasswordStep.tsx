import type { ReactNode } from "react";
import { Button } from "../../primitives/button";
import { ScreenFooter } from "../../primitives/screen-footer";
import { ScreenHeader } from "../../primitives/screen-header";
import { PasswordField } from "./PasswordField";
import { StepForm, StepIntro } from "./step-layout";
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
      <StepForm
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && password.length > 0) onSubmit(password);
        }}
      >
        <StepIntro title={heading} body={body} />

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
      </StepForm>
    </div>
  );
}
