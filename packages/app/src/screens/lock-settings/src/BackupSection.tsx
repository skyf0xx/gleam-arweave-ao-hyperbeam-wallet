import { useEffect, useState } from "react";
import type { BackupProvider, BackupStatus, RuntimePort } from "@gleam/core";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { useT } from "../../../i18n";
import { backupDriveName, backupSummary } from "../../backup/src/BackupView";

/** Security's Backup row: where the backup lives and how current it is. The Backup screen does the rest. */
export function BackupSection({ runtime, provider, onOpen }: { runtime: RuntimePort; provider: BackupProvider; onOpen: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<BackupStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    runtime.send<void, BackupStatus>({ type: "getBackupStatus", payload: undefined }).then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {
        if (!cancelled) setStatus({ provider, enabled: false, lastBackupAt: null, problem: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, provider]);

  const summary = status ? backupSummary(t, status) : "";
  const current = status?.enabled && status.problem === null;

  return (
    <div className="pb-10 phone:pb-8">
      <div className="pb-1 text-label font-semibold uppercase tracking-[0.04em] text-muted">{t("backup.title")}</div>
      {status === null ? (
        <SkeletonRow />
      ) : (
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-3.5 text-left hover:bg-mist">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-mist text-foreground">
            <CloudIcon />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label font-semibold text-foreground">{backupDriveName(provider)}</span>
            <span className={status.problem ? "text-caption font-semibold text-warning" : "text-caption text-muted"}>
              {current ? `${t("backup.lastBackup")} · ${summary}` : summary}
            </span>
          </span>
          <span aria-hidden="true" className="flex-shrink-0 text-faint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}

function CloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
