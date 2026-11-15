import { useEffect, useState } from "react";
import type { BackupProvider, BackupStatus, RuntimePort } from "@gleam/core";
import { PasswordField } from "@gleam/ui/src/components/onboarding/index.ts";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { CheckIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";
import { useT, type TFunction } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { relativeTime } from "../../../relative-time";

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
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [confirming, setConfirming] = useState<"stop" | "delete" | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (phase !== "done") return;
    const timer = setTimeout(() => setPhase("idle"), DONE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    runtime
      .send<void, BackupStatus>({ type: "getBackupStatus", payload: undefined })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const run = async (next: "settingUp" | "syncing", request: () => Promise<BackupStatus>) => {
    setPhase(next);
    setError(undefined);
    try {
      setStatus(await request());
      setPassword("");
      setConfirming(null);
      setPhase("done");
    } catch (reason) {
      setError(errorText(reason));
      // A sign-in that was closed leaves a problem only a fresh read shows.
      runtime.send<void, BackupStatus>({ type: "getBackupStatus", payload: undefined }).then(setStatus, () => {});
      setPhase("idle");
    }
  };

  const setUp = () =>
    run("settingUp", () => runtime.send<{ password: string }, BackupStatus>({ type: "setUpBackup", payload: { password } }));
  const syncNow = () => run("syncing", () => runtime.send<void, BackupStatus>({ type: "syncBackupNow", payload: undefined }));
  const leave = async (next: "stopping" | "deleting") => {
    setPhase(next);
    setError(undefined);
    try {
      await runtime.send<void, BackupStatus>({ type: next === "stopping" ? "stopBackupSync" : "deleteBackup", payload: undefined });
      onBack();
    } catch (reason) {
      setError(errorText(reason));
      setPhase("idle");
    }
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
              if (!busy && password.length > 0) void setUp();
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
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(null)} className="flex-1">
                    {t("backup.cancel")}
                  </Button>
                  <Button type="button" disabled={busy} aria-busy={busy} onClick={() => void leave("stopping")} className="flex-1">
                    {t("backup.stopSyncing")}
                  </Button>
                </div>
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
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(null)} className="flex-1">
                    {t("backup.cancel")}
                  </Button>
                  <Button type="button" variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void leave("deleting")} className="flex-1">
                    {phase === "deleting" ? t("backup.deleting") : t("backup.deleteBackup")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-auto flex flex-col gap-2.5">
                <Button type="button" disabled={busy} aria-busy={busy && phase !== "done"} onClick={() => void syncNow()}>
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
          <p role="alert" className="text-caption text-warning">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
