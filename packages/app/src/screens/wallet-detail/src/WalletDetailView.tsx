import { useEffect, useState } from "react";
import { usePlatform } from "../../../app-platform/context";
import { capabilitiesFor, isHardwareWalletMethod, type BackupStatus, type RuntimePort, type WalletSummary } from "@gleam/core";
import {
  downloadKeyfile,
  keyfileDownloadError,
  type RequestDownloadsPermission,
} from "../../../keyfile/download";
import { AccountAvatar, MemorableAddress } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { useAddressIdentity } from "../../../address-identity";
import { useCopy } from "../../points/src/useCopy";
import { useT, type TFunction } from "../../../i18n";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { errorText } from "../../../i18n/errors";
import { CheckIcon, CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";
import { backupDriveName } from "../../backup/src/BackupView";

// JWK is what nearly every wallet is, so only the other methods get a label.
const walletMethodLabel = (t: TFunction, method: WalletSummary["method"]): string | null => {
  switch (method) {
    case "jwk":
      return null;
    case "ethereum":
      return "Ethereum";
    case "ledger":
      return "Ledger";
    case "keystone":
      return "Keystone";
    case "watch":
      return t("walletDetail.watchOnly");
  }
};

function formatBackupDate(t: TFunction, timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t("walletDetail.backedUpToday");
  if (days === 1) return t("walletDetail.backedUpYesterday");
  return t("walletDetail.backedUpDaysAgo", { days });
}

/**
 * Where the cloud backup holds this wallet, or null. It does once a write
 * that came after the wallet was added has gone through and nothing has
 * stopped writes since.
 */
export function cloudBackupOf(status: BackupStatus, wallet: Pick<WalletSummary, "createdAt">): string | null {
  if (!status.provider || !status.enabled || status.problem !== null || status.lastBackupAt === null) return null;
  return status.lastBackupAt >= wallet.createdAt ? backupDriveName(status.provider) : null;
}

/**
 * `backupConfirmedAt` is set only after the background reports the
 * keyfile download finished. A cancelled or failed download leaves it
 * unset, so removal flows never trust a backup that was never made. An
 * old stored record with no value for the field counts as not backed up.
 */
export interface WalletDetailViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  onBack: () => void;
  onRenamed: (name: string) => void;
  /** Called after `deleteWallet` succeeds — the caller re-derives its view from `getState` (removing the last wallet returns to onboarding on its own). */
  onRemoved: () => void;
  /** Asks for the optional `downloads` permission from the Download click. */
  requestDownloadPermission?: RequestDownloadsPermission;
}

type Step =
  | { kind: "detail" }
  | { kind: "export-password"; submitting: boolean; serverError?: string }
  | { kind: "remove-confirm"; removing: boolean; serverError?: string };

export function WalletDetailView({
  runtime,
  wallet,
  onBack,
  onRenamed,
  onRemoved,
  requestDownloadPermission,
}: WalletDetailViewProps) {
  const t = useT();
  const { downloads, capabilities } = usePlatform();
  const identity = useAddressIdentity();
  const avatarSvg = identity.avatarSvg(wallet.address);
  const { copied: addressCopied, copy: copyAddress } = useCopy(wallet.address);

  const [name, setName] = useState(wallet.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [backupConfirmedAt, setBackupConfirmedAt] = useState(wallet.backupConfirmedAt);
  const [step, setStep] = useState<Step>({ kind: "detail" });
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [cloudBackup, setCloudBackup] = useState<string | null>(null);

  const cloudProvider = capabilities.cloudBackup;
  const createdAt = wallet.createdAt;
  useEffect(() => {
    if (!cloudProvider) return;
    let cancelled = false;
    runtime.send<void, BackupStatus>({ type: "getBackupStatus", payload: undefined }).then(
      (status) => {
        if (!cancelled) setCloudBackup(cloudBackupOf(status, { createdAt }));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, cloudProvider, createdAt]);

  const trimmedName = name.trim();
  const nameChanged = trimmedName.length > 0 && trimmedName !== wallet.name;

  const handleRename = async () => {
    if (!nameChanged || savingName) return;
    setSavingName(true);
    setNameError(null);
    try {
      await runtime.send<{ walletId: string; name: string }, void>({
        type: "renameWallet",
        payload: { walletId: wallet.id, name: trimmedName },
      });
      onRenamed(trimmedName);
    } catch (error) {
      setNameError(errorText(error));
    } finally {
      setSavingName(false);
    }
  };

  const handleExportPassword = async (password: string) => {
    setStep({ kind: "export-password", submitting: true });
    try {
      const result = await downloadKeyfile(runtime, { walletId: wallet.id, password }, requestDownloadPermission ?? downloads.requestPermission);
      if (!result.ok) {
        setStep({ kind: "export-password", submitting: false, serverError: keyfileDownloadError(result) ?? undefined });
        return;
      }
      // The background has already recorded the backup.
      setSavedAs(result.filename);
      setBackupConfirmedAt((current) => current ?? Date.now());
      setStep({ kind: "detail" });
    } catch (error) {
      setStep({
        kind: "export-password",
        submitting: false,
        serverError: errorText(error),
      });
    }
  };

  const handleRemove = async () => {
    setStep({ kind: "remove-confirm", removing: true });
    try {
      await runtime.send<{ walletId: string }, void>({
        type: "deleteWallet",
        payload: { walletId: wallet.id },
      });
      onRemoved();
    } catch (error) {
      setStep({
        kind: "remove-confirm",
        removing: false,
        serverError: errorText(error),
      });
    }
  };

  const hardware = isHardwareWalletMethod(wallet.method);
  const watchOnly = wallet.method === "watch";
  const methodLabel = walletMethodLabel(t, wallet.method);

  if (step.kind === "remove-confirm") {
    return (
      <RemoveConfirmStep
        walletName={wallet.name}
        hardware={hardware}
        watchOnly={watchOnly}
        backedUp={backupConfirmedAt !== null}
        onBack={() => setStep({ kind: "detail" })}
        onConfirm={() => void handleRemove()}
        removing={step.removing}
        serverError={step.serverError}
      />
    );
  }

  if (step.kind === "export-password") {
    return (
      <ExportPasswordStep
        onBack={() => setStep({ kind: "detail" })}
        onSubmit={(password) => void handleExportPassword(password)}
        submitting={step.submitting}
        serverError={step.serverError}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("walletDetail.title")} onBack={onBack} />

      <div className="flex flex-1 flex-col gap-6 px-6 phone:px-5 pb-6 pt-7 phone:pt-4">
        <div className="group flex items-center gap-3.5 phone:items-start">
          <AccountAvatar svgMarkup={avatarSvg} label={t("walletDetail.avatarOf", { name: wallet.name })} size={44} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* Copy sits in the name line so the address keeps the full width. */}
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-label font-semibold text-foreground">
                {wallet.name}
                {methodLabel ? <span className="font-normal text-faint"> · {methodLabel}</span> : null}
              </span>
              <button
                type="button"
                onClick={copyAddress}
                aria-label={addressCopied ? t("walletDetail.addressCopied") : t("walletDetail.copyAddress")}
                title={addressCopied ? t("walletDetail.copied") : t("walletDetail.copyAddress")}
                className={`-my-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-mist focus-visible:opacity-100 group-hover:opacity-100 phone:opacity-100 phone:hit-target ${addressCopied ? "text-positive opacity-100" : "text-faint opacity-0 hover:text-foreground"}`}
              >
                {addressCopied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              </button>
            </div>
            <MemorableAddress address={wallet.address} emphasisPick={identity.emphasisPick} className="-ml-[0.35ch] phone:-ml-[0.25ch]" />
          </div>
        </div>

        <TextField
          label={t("walletDetail.name")}
          value={name}
          disabled={savingName}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          onBlur={() => void handleRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          errorMessage={nameError ?? undefined}
        />

        {capabilitiesFor(wallet.method).exportKey ? (
          <button
            type="button"
            onClick={() => setStep({ kind: "export-password", submitting: false })}
            aria-describedby="keyfile-backup-status"
            className="flex w-full items-center gap-2.5 rounded-lg bg-foreground/[0.03] px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.05]"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label font-semibold text-foreground">{t("walletDetail.backUpKeyfile")}</span>
              <span
                id="keyfile-backup-status"
                className={`truncate text-caption ${backupConfirmedAt !== null || savedAs || cloudBackup ? "text-muted" : "font-semibold text-warning"}`}
              >
                {savedAs
                  ? t("walletDetail.savedAs", { filename: savedAs })
                  : backupConfirmedAt !== null
                    ? formatBackupDate(t, backupConfirmedAt)
                    : cloudBackup
                      ? t("walletDetail.inCloudBackup", { drive: cloudBackup })
                      : t("walletDetail.notBackedUp")}
              </span>
            </span>
            <ChevronIcon />
          </button>
        ) : null}

        {/* The solid destructive button is for the confirm step; this only opens it. */}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep({ kind: "remove-confirm", removing: false })}
          className="mt-auto text-warning hover:text-warning"
        >
          {t("walletDetail.removeWallet")}
        </Button>
      </div>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="flex-shrink-0 text-faint">
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RemoveConfirmStep({
  walletName,
  hardware,
  watchOnly,
  backedUp,
  onBack,
  onConfirm,
  removing,
  serverError,
}: {
  walletName: string;
  hardware: boolean;
  watchOnly: boolean;
  backedUp: boolean;
  onBack: () => void;
  onConfirm: () => void;
  removing: boolean;
  serverError?: string;
}) {
  const t = useT();
  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("walletDetail.removeWallet")} onBack={onBack} busy={removing} />
      <div className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0">
        <p className="text-body leading-relaxed text-muted">
          {t("walletDetail.removeIntroBefore")}
          <span className="font-semibold text-foreground">{walletName}</span>
          {t("walletDetail.removeIntroAfter")}
        </p>

        {watchOnly ? (
          <p className="text-body leading-relaxed text-muted">
            {t("walletDetail.removeWatch")}
          </p>
        ) : hardware ? (
          <p className="text-body leading-relaxed text-muted">
            {t("walletDetail.removeHardware")}
          </p>
        ) : !backedUp ? (
          <RiskNotice>
            {t("walletDetail.removeNotBackedUp")}
          </RiskNotice>
        ) : (
          <p className="text-body leading-relaxed text-muted">
            {t("walletDetail.removeBackedUp")}
          </p>
        )}

        {serverError ? (
          <p role="alert" className="text-caption leading-relaxed text-warning">
            {serverError}
          </p>
        ) : null}

        <ScreenFooter className="mt-8" pinned={false}>
          <Button type="button" variant="destructive" disabled={removing} onClick={onConfirm}>
            {removing ? t("walletDetail.removing") : t("walletDetail.confirmRemove")}
          </Button>
        </ScreenFooter>
      </div>
    </div>
  );
}

function ExportPasswordStep({
  onBack,
  onSubmit,
  submitting,
  serverError,
}: {
  onBack: () => void;
  onSubmit: (password: string) => void;
  submitting: boolean;
  serverError?: string;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [capsLockOn, setCapsLockOn] = useState(false);

  const [clearedFor, setClearedFor] = useState<string | undefined>(undefined);
  if (submitting && clearedFor !== undefined) setClearedFor(undefined);
  if (!submitting && serverError && serverError !== clearedFor) {
    setClearedFor(serverError);
    setPassword("");
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("walletDetail.backUpKeyfile")} onBack={onBack} busy={submitting} />
      <form
        className="flex flex-1 flex-col gap-5 px-6 phone:px-5 py-6 phone:pb-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (!submitting && password.length > 0) onSubmit(password);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h3 font-semibold tracking-tight text-foreground">{t("walletDetail.enterPassword")}</h1>
          <p className="text-body leading-relaxed text-muted">
            {t("walletDetail.exportExplain")}
          </p>
        </div>

        <RiskNotice>
          {t("walletDetail.keyfileWarning")}
        </RiskNotice>

        <PasswordField
          label={t("walletDetail.password")}
          placeholder={t("walletDetail.enterPassword")}
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
          <Button type="submit" disabled={submitting || password.length === 0}>
            {submitting ? t("walletDetail.saving") : t("walletDetail.saveKeyfile")}
          </Button>
        </ScreenFooter>
      </form>
    </div>
  );
}

