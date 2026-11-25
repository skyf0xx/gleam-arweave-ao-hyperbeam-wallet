import { PasswordStep } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { useT } from "../../../i18n";

/**
 * The one step of a restore: the vault password, or a passkey the backup
 * lists, which opens the backup found in the account. Nothing is written
 * to this device until it does.
 */
export interface RestoreBackupProps {
  /** "Google" or "iCloud". */
  account: string;
  onBack: () => void;
  onSubmit: (password: string) => void;
  /** Set when the backup lists a passkey this device can use in place of the password. */
  onUsePasskey?: () => void;
  /** The passkey prompt is open. */
  passkeyBusy?: boolean;
  submitting?: boolean;
  serverError?: string;
}

export function RestoreBackup({ account, onBack, onSubmit, onUsePasskey, passkeyBusy = false, submitting = false, serverError }: RestoreBackupProps) {
  const t = useT();
  return (
    <PasswordStep
      headerTitle={t("backup.restoreFrom", { account })}
      heading={t("backup.restoreTitle")}
      body={t("backup.restoreBody")}
      passwordLabel={t("backup.password")}
      placeholder={t("backup.passwordPlaceholder")}
      submitLabel={t("backup.restore")}
      submittingLabel={t("backup.restoring")}
      onBack={onBack}
      onSubmit={onSubmit}
      submitting={submitting}
      submitBusy={submitting && !passkeyBusy}
      serverError={serverError}
      secondaryAction={
        onUsePasskey ? (
          <Button type="button" variant="secondary" disabled={submitting} aria-busy={passkeyBusy} onClick={onUsePasskey}>
            {passkeyBusy ? t("unlock.waitingForPasskey") : t("unlock.usePasskey")}
          </Button>
        ) : null
      }
    />
  );
}
