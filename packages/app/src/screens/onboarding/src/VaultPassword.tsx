import { PasswordStep } from "@gleam/ui/src/components/onboarding/index.ts";
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
  return (
    <PasswordStep
      headerTitle={title}
      heading={t("onboarding.enterPasswordTitle")}
      body={t("onboarding.vaultPasswordBody")}
      passwordLabel={t("onboarding.passwordLabel")}
      placeholder={t("onboarding.enterPasswordPlaceholder")}
      submitLabel={t("onboarding.continue")}
      submittingLabel={t("onboarding.adding")}
      onBack={onBack}
      onSubmit={onSubmit}
      submitting={submitting}
      serverError={serverError}
    />
  );
}
