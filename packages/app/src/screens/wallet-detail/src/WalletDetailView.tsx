import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { PasswordStep, StepColumn } from "@gleam/ui/src/components/onboarding/index.ts";
import { useAddressIdentity } from "../../../address-identity";
import { useCopy } from "@gleam/ui/src/primitives/use-copy.ts";
import { useT, type TFunction } from "../../../i18n";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { errorText } from "../../../i18n/errors";
import { backupDriveName } from "../../backup/src/BackupView";
import { CopyButton } from "@gleam/ui/src/primitives/copy-button.tsx";
import { useBackupStatus } from "../../backup/src/useBackup";
import { WALLET_STATE_QUERY_KEY } from "../../activity/src/useWalletState";

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

type Step = "detail" | "export-password" | "remove-confirm";

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
  const [nameError, setNameError] = useState<string | null>(null);
  const [backupConfirmedAt, setBackupConfirmedAt] = useState(wallet.backupConfirmedAt);
  const [step, setStep] = useState<Step>("detail");
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const cloudProvider = capabilities.cloudBackup;
  const createdAt = wallet.createdAt;
  const backupQuery = useBackupStatus(runtime, Boolean(cloudProvider));
  const cloudBackup = backupQuery.data ? cloudBackupOf(backupQuery.data, { createdAt }) : null;

  const trimmedName = name.trim();
  const nameChanged = trimmedName.length > 0 && trimmedName !== wallet.name;

  const queryClient = useQueryClient();
  const renameMutation = useMutation({
    mutationFn: (newName: string) =>
      runtime.send<{ walletId: string; name: string }, void>({ type: "renameWallet", payload: { walletId: wallet.id, name: newName } }),
    onSuccess: (_result, newName) => {
      void queryClient.invalidateQueries({ queryKey: WALLET_STATE_QUERY_KEY });
      onRenamed(newName);
    },
    onError: (caught) => setNameError(errorText(caught)),
  });
  const savingName = renameMutation.isPending;

  const handleRename = () => {
    if (!nameChanged || savingName) return;
    setNameError(null);
    renameMutation.mutate(trimmedName);
  };

  const [exportError, setExportError] = useState<string | undefined>(undefined);
  const exportMutation = useMutation({
    mutationFn: (password: string) =>
      downloadKeyfile(runtime, { walletId: wallet.id, password }, requestDownloadPermission ?? downloads.requestPermission),
    onSuccess: (result) => {
      if (!result.ok) {
        setExportError(keyfileDownloadError(result) ?? undefined);
        return;
      }
      // The background has already recorded the backup.
      setSavedAs(result.filename);
      setBackupConfirmedAt((current) => current ?? Date.now());
      setStep("detail");
    },
    onError: (caught) => setExportError(errorText(caught)),
  });

  const removeMutation = useMutation({
    mutationFn: () => runtime.send<{ walletId: string }, void>({ type: "deleteWallet", payload: { walletId: wallet.id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WALLET_STATE_QUERY_KEY });
      onRemoved();
    },
  });

  const hardware = isHardwareWalletMethod(wallet.method);
  const watchOnly = wallet.method === "watch";
  const methodLabel = walletMethodLabel(t, wallet.method);

  if (step === "remove-confirm") {
    return (
      <RemoveConfirmStep
        walletName={wallet.name}
        hardware={hardware}
        watchOnly={watchOnly}
        backedUp={backupConfirmedAt !== null}
        onBack={() => setStep("detail")}
        onConfirm={() => removeMutation.mutate()}
        removing={removeMutation.isPending || removeMutation.isSuccess}
        serverError={removeMutation.isError ? errorText(removeMutation.error) : undefined}
      />
    );
  }

  if (step === "export-password") {
    return (
      <ExportPasswordStep
        onBack={() => setStep("detail")}
        onSubmit={(password) => {
          setExportError(undefined);
          exportMutation.mutate(password);
        }}
        submitting={exportMutation.isPending}
        serverError={exportError}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("walletDetail.title")} onBack={onBack} />

      <div className="flex flex-1 flex-col gap-6 px-6 phone:px-5 pb-6 pt-7 phone:pt-4">
        <div className="gleam-lens-up group flex items-center gap-3.5 phone:items-start silica:-mx-6 silica:-mt-7 silica:px-6 silica:pb-5 silica:pt-7 phone:silica:-mx-5 phone:silica:-mt-4 phone:silica:px-5 phone:silica:pt-4">
          <AccountAvatar svgMarkup={avatarSvg} label={t("walletDetail.avatarOf", { name: wallet.name })} size={44} />
          {/* The name is edited in the field below, so this block shows only the address. */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {methodLabel ? <span className="text-label text-faint">{methodLabel}</span> : null}
            <MemorableAddress address={wallet.address} emphasisPick={identity.emphasisPick} className="-ml-[0.35ch] phone:-ml-[0.25ch]" />
          </div>
          <CopyButton
            copied={addressCopied}
            onCopy={copyAddress}
            label={addressCopied ? t("walletDetail.addressCopied") : t("walletDetail.copyAddress")}
            title={addressCopied ? t("walletDetail.copied") : t("walletDetail.copyAddress")}
            iconSize={15}
            reveal
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-hover focus-visible:opacity-100 group-hover:opacity-100 phone:opacity-100 phone:hit-target"
          />
        </div>

        <TextField
          label={t("walletDetail.name")}
          value={name}
          disabled={savingName}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          onBlur={handleRename}
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
            onClick={() => {
            setExportError(undefined);
            setStep("export-password");
          }}
            aria-describedby="keyfile-backup-status"
            className="flex w-full items-center gap-2.5 gleam-hover-frost rounded-lg bg-foreground/[0.03] px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.05] silica:hover:bg-foreground/[0.03]"
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
          onClick={() => {
            removeMutation.reset();
            setStep("remove-confirm");
          }}
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="gleam-chevron flex-shrink-0 text-faint">
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
      <StepColumn>
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
      </StepColumn>
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
  return (
    <PasswordStep
      headerTitle={t("walletDetail.backUpKeyfile")}
      heading={t("walletDetail.enterPassword")}
      body={t("walletDetail.exportExplain")}
      notice={<RiskNotice>{t("walletDetail.keyfileWarning")}</RiskNotice>}
      passwordLabel={t("walletDetail.password")}
      placeholder={t("walletDetail.enterPassword")}
      submitLabel={t("walletDetail.saveKeyfile")}
      submittingLabel={t("walletDetail.saving")}
      onBack={onBack}
      onSubmit={onSubmit}
      submitting={submitting}
      serverError={serverError}
    />
  );
}

