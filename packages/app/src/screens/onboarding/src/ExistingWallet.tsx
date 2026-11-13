import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { OptionRow, OptionSection } from "@gleam/ui/src/primitives/option-list.tsx";
import { usePlatform } from "../../../app-platform/context";
import { hasHardwareWallet } from "../../../app-platform/hardware";
import { useT } from "../../../i18n";

/**
 * The ways to bring in a wallet the user already has, grouped by where it
 * comes from rather than by format: another wallet's phrase, keyfile or
 * address under one heading, devices under another. A heading over a
 * single self-explanatory row only adds reading, so don't add one.
 * Shown after Welcome's "I already have a wallet", and as part of
 * `AddWalletStart`.
 */
export interface ExistingWalletOptionsProps {
  onImport: () => void;
  onImportPhrase: () => void;
  onConnectKeystone: () => void;
  onConnectLedger: () => void;
  onWatch: () => void;
}

export function ExistingWalletOptions({ onImport, onImportPhrase, onConnectKeystone, onConnectLedger, onWatch }: ExistingWalletOptionsProps) {
  const t = useT();
  const { capabilities } = usePlatform();
  const { ledger, keystone } = capabilities.hardwareWallets;
  return (
    <>
      <OptionSection title={t("onboarding.fromAnotherWallet")}>
        <OptionRow title={t("onboarding.phraseOption")} description={t("onboarding.phraseOptionHint")} onClick={onImportPhrase} />
        <OptionRow title={t("onboarding.keyfileOption")} description={t("onboarding.keyfileOptionHint")} onClick={onImport} />
        <OptionRow title={t("onboarding.watchAddress")} description={t("onboarding.watchOptionHint")} onClick={onWatch} />
      </OptionSection>
      {hasHardwareWallet(capabilities) ? (
        <OptionSection title={t("onboarding.hardwareWallet")}>
          {ledger ? <OptionRow title="Ledger" description={t("onboarding.ledgerHint")} onClick={onConnectLedger} /> : null}
          {keystone ? (
            <OptionRow title="Keystone" description={t("onboarding.keystoneHint")} onClick={onConnectKeystone} />
          ) : null}
        </OptionSection>
      ) : null}
    </>
  );
}

/** The vault backup in the user's cloud account, offered where the shell can reach one. */
export interface RestoreOption {
  /** "Google" or "iCloud". */
  account: string;
  onRestore: () => void;
  /** Signing in and looking for the backup. */
  busy: boolean;
  error?: string;
}

export interface ExistingWalletProps extends ExistingWalletOptionsProps {
  onBack: () => void;
  restore?: RestoreOption;
}

export function ExistingWallet({ onBack, restore, ...options }: ExistingWalletProps) {
  const t = useT();
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("onboarding.useExistingWallet")} onBack={onBack} busy={restore?.busy} />
      <div className="flex flex-1 flex-col gap-6 px-6 phone:px-5 py-6">
        {restore ? (
          <div className="flex flex-col">
            <OptionRow
              title={t("backup.restoreFrom", { account: restore.account })}
              description={t("backup.restoreHint")}
              disabled={restore.busy}
              onClick={restore.onRestore}
            />
            {restore.error ? (
              <p role="alert" className="text-caption text-warning">
                {restore.error}
              </p>
            ) : null}
          </div>
        ) : null}
        <ExistingWalletOptions {...options} />
      </div>
    </div>
  );
}
