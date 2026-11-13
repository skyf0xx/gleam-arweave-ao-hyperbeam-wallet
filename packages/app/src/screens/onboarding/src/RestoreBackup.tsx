import { useState } from "react";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { useT } from "../../../i18n";

/**
 * The one step of a restore: the vault password, which opens the backup
 * found in the account. Nothing is written to this device until it does.
 */
export interface RestoreBackupProps {
  /** "Google" or "iCloud". */
  account: string;
  onBack: () => void;
  onSubmit: (password: string) => void;
  submitting?: boolean;
  serverError?: string;
}

export function RestoreBackup({ account, onBack, onSubmit, submitting = false, serverError }: RestoreBackupProps) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("backup.restoreFrom", { account })} onBack={onBack} busy={submitting} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && password.length > 0) onSubmit(password);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">{t("backup.restoreTitle")}</h1>
          <p className="text-body leading-relaxed text-muted">{t("backup.restoreBody")}</p>
        </div>

        <PasswordField
          label={t("backup.password")}
          placeholder={t("backup.passwordPlaceholder")}
          autoFocus
          autoComplete="current-password"
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
          onKeyUp={(event) => setCapsLockOn(event.getModifierState?.("CapsLock") ?? false)}
          capsLockOn={capsLockOn}
          errorMessage={serverError}
        />

        <ScreenFooter className="mt-8">
          <Button type="submit" disabled={submitting || password.length === 0} aria-busy={submitting}>
            {submitting ? t("backup.restoring") : t("backup.restore")}
          </Button>
        </ScreenFooter>
      </form>
    </div>
  );
}
