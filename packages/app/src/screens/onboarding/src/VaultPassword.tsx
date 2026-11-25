import { PasswordField, usePasswordEntry } from "@gleam/ui/src/components/onboarding/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { useT } from "../../../i18n";

/**
 * Asks for the existing vault password when adding a wallet. Every wallet
 * shares one password, so this never offers to set a new one; the
 * background checks it against a stored wallet.
 */
export interface VaultPasswordProps {
  title: string;
  onBack: () => void;
  onSubmit: (password: string) => void;
  submitting?: boolean;
  serverError?: string;
}

export function VaultPassword({
  title,
  onBack,
  onSubmit,
  submitting = false,
  serverError,
}: VaultPasswordProps) {
  const t = useT();
  const { password, setPassword } = usePasswordEntry({ submitting, serverError });

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={title} onBack={onBack} busy={submitting} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && password.length > 0) onSubmit(password);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">{t("onboarding.enterPasswordTitle")}</h1>
          <p className="text-body leading-relaxed text-muted">
            {t("onboarding.vaultPasswordBody")}
          </p>
        </div>

        <PasswordField
          label={t("onboarding.passwordLabel")}
          placeholder={t("onboarding.enterPasswordPlaceholder")}
          autoFocus
          autoComplete="current-password"
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
          errorMessage={serverError}
        />

        <ScreenFooter className="mt-8">
          <Button type="submit" disabled={submitting || password.length === 0}>
            {submitting ? t("onboarding.adding") : t("onboarding.continue")}
          </Button>
        </ScreenFooter>
      </form>
    </div>
  );
}
