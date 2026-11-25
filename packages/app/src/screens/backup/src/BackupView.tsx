import { useEffect, useState } from "react";
import type { BackupProvider, BackupStatus, RuntimePort } from "@gleam/core";
import { useBackupStatus, useLeaveBackup, useSetUpBackup, useSyncBackup } from "./useBackup";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { CheckIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT, type TFunction } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { relativeTime } from "../../../relative-time";
import { ButtonPair } from "@gleam/ui/src/primitives/button-pair.tsx";

/** The account's own name, which is never translated. */
export function backupAccountName(provider: BackupProvider): string {
  return provider === "google" ? "Google" : "iCloud";
}

/** Where the file lives, as the account's owner knows it. */
export function backupDriveName(provider: BackupProvider): string {
  return provider === "google" ? "Google Drive" : "iCloud";
}

/** The backup's state in a few words, for the Settings row and this screen. */
export function backupSummary(t: TFunction, status: BackupStatus): string {
  if (!status.enabled) return t("backup.off");
  if (status.problem === "signIn") return t("backup.needsSignIn");
  if (status.problem === "missing") return t("backup.notFound");
  if (status.problem === "otherPassword") return t("backup.otherPassword");
  return status.lastBackupAt === null ? t("backup.never") : relativeTime(t, status.lastBackupAt);
}

/** Stands in for the bold words while the sentence around them is translated. */
const BOLD_MARK = "\u0000";

/** `text` with `bold` set in its place, so a translation can put the words anywhere in the sentence. */
function WithBold({ text, bold }: { text: string; bold: string }) {
  const [before, after = ""] = text.split(BOLD_MARK);
  return (
    <>
      {before}
      <strong className="font-semibold text-foreground">{bold}</strong>
      {after}
    </>
  );
}

export interface BackupViewProps {
  runtime: RuntimePort;
  onBack: () => void;
}

type Phase = "idle" | "settingUp" | "syncing" | "stopping" | "deleting" | "done";

/** How long "Synced" holds the button after a sync, so a fast one is still seen. */
export const DONE_MS = 2_500;

/**
 * Settings → Backup. Off, it is one password field and one button: the
 * password wraps the backup's key, and an unlocked vault doesn't keep it.
 * On, it shows when the backup was last written and lets the user sync
 * now (pull other devices' additions, then write), stop syncing on this
 * device, or, past that, delete the file for every device.
 */
export function BackupView({ runtime, onBack }: BackupViewProps) {
  const t = useT();
  const statusQuery = useBackupStatus(runtime);
  const status = statusQuery.data ?? null;
  const setUpMutation = useSetUpBackup(runtime);
  const syncMutation = useSyncBackup(runtime);
  const leaveMutation = useLeaveBackup(runtime);
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState<"stop" | "delete" | null>(null);
  const [done, setDone] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const error = actionError ?? (status === null && statusQuery.isError ? errorText(statusQuery.error) : undefined);
  const phase: Phase = done
    ? "done"
    : setUpMutation.isPending
      ? "settingUp"
      : syncMutation.isPending
        ? "syncing"
        : leaveMutation.isPending || leaveMutation.isSuccess
          ? (leaveMutation.variables ?? "idle")
          : "idle";

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const finished = () => {
    setPassword("");
    setConfirming(null);
    setDone(true);
  };
  const failed = (reason: unknown) => setActionError(errorText(reason));

  const setUp = () => {
    setActionError(undefined);
    setUpMutation.mutate(password, { onSuccess: finished, onError: failed });
  };
  const syncNow = () => {
    setActionError(undefined);
    syncMutation.mutate(undefined, { onSuccess: finished, onError: failed });
  };
  const leave = (next: "stopping" | "deleting") => {
    setActionError(undefined);
    leaveMutation.mutate(next, { onSuccess: onBack, onError: failed });
  };

  const busy = phase !== "idle";
  const account = status?.provider ? backupAccountName(status.provider) : "";
  const drive = status?.provider ? backupDriveName(status.provider) : "";

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("backup.title")} onBack={onBack} busy={busy} />
      <div className="flex flex-1 flex-col gap-5 px-6 pb-6 pt-4 phone:px-5">
        {status === null ? (
          error ? null : <SkeletonRow />
        ) : !status.enabled ? (
          <form
            className="flex flex-1 flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && password.length > 0) setUp();
            }}
          >
            <div className="flex flex-col gap-2.5">
              <h1 className="text-h3 font-semibold tracking-tight text-foreground">{t("backup.setUpTitle")}</h1>
              <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-label leading-relaxed text-muted marker:text-faint">
                <li>
                  <WithBold
                    text={t("backup.pointEncrypted", { items: BOLD_MARK, drive: status.provider ? backupDriveName(status.provider) : "" })}
                    bold={t("backup.backedUpItems")}
                  />
                </li>
                <li>{t("backup.pointRestore")}</li>
                <li>{t("backup.pointLost")}</li>
              </ol>
            </div>
            <PasswordField
              label={t("backup.password")}
              placeholder={t("backup.passwordPlaceholder")}
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              errorMessage={error}
            />
            <Button type="submit" disabled={busy || password.length === 0} aria-busy={busy} className="mt-auto">
              {busy ? t("backup.backingUp") : t("backup.backUpTo", { account })}
            </Button>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2.5 py-3.5">
              <span className="flex-1 text-label font-semibold text-foreground">{t("backup.lastBackup")}</span>
              <span className={status.problem ? "text-label font-semibold text-warning" : "text-label text-muted"}>
                {backupSummary(t, status)}
              </span>
            </div>
            {confirming === "stop" ? (
              <div className="mt-auto flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-body text-foreground">{t("backup.stopConfirm")}</p>
                  <p className="text-caption text-muted">{t("backup.stillIn", { drive })}</p>
                </div>
                <ButtonPair
                  cancelLabel={t("backup.cancel")}
                  onCancel={() => setConfirming(null)}
                  cancelDisabled={busy}
                  confirmLabel={t("backup.stopSyncing")}
                  onConfirm={() => leave("stopping")}
                  confirmDisabled={busy}
                  confirmBusy={busy}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirming("delete")}
                  className="text-warning hover:text-warning"
                >
                  {t("backup.deleteFrom", { drive })}
                </Button>
              </div>
            ) : confirming === "delete" ? (
              <div className="mt-auto flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-body text-foreground">{t("backup.deleteConfirm", { drive })}</p>
                  <p className="text-caption text-muted">{t("backup.everyDevice")}</p>
                </div>
                <ButtonPair
                  cancelLabel={t("backup.cancel")}
                  onCancel={() => setConfirming(null)}
                  cancelDisabled={busy}
                  confirmLabel={phase === "deleting" ? t("backup.deleting") : t("backup.deleteBackup")}
                  confirmVariant="destructive"
                  onConfirm={() => leave("deleting")}
                  confirmDisabled={busy}
                  confirmBusy={busy}
                />
              </div>
            ) : (
              <div className="mt-auto flex flex-col gap-2.5">
                <Button type="button" disabled={busy} aria-busy={busy && phase !== "done"} onClick={() => syncNow()}>
                  {phase === "done" ? (
                    <span role="status" className="flex items-center gap-1.5">
                      <CheckIcon size={16} />
                      {t("backup.synced")}
                    </span>
                  ) : phase === "syncing" ? (
                    t("backup.syncing")
                  ) : status.problem === "signIn" ? (
                    t("backup.signIn")
                  ) : (
                    t("backup.syncNow")
                  )}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming("stop")}>
                  {t("backup.stopSyncing")}
                </Button>
              </div>
            )}
          </>
        )}
        {error && (status === null || status.enabled) ? (
          <InlineError>
            {error}
          </InlineError>
        ) : null}
      </div>
    </div>
  );
}
