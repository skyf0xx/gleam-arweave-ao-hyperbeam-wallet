import type { BackupProvider, BackupStatus, RuntimePort } from "@gleam/core";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { IconRow, SettingsSectionTitle } from "@gleam/ui/src/primitives/setting-rows.tsx";
import { useT } from "../../../i18n";
import { useBackupStatus } from "../../backup/src/useBackup";
import { backupDriveName, backupSummary } from "../../backup/src/BackupView";

/** Security's Backup row: where the backup lives and how current it is. The Backup screen does the rest. */
export function BackupSection({ runtime, provider, onOpen }: { runtime: RuntimePort; provider: BackupProvider; onOpen: () => void }) {
  const t = useT();
  const statusQuery = useBackupStatus(runtime);
  const status: BackupStatus | null = statusQuery.data ?? (statusQuery.isError ? { provider, enabled: false, lastBackupAt: null, problem: null } : null);

  const summary = status ? backupSummary(t, status) : "";
  const current = status?.enabled && status.problem === null;

  return (
    <div className="pb-10 phone:pb-8">
      <SettingsSectionTitle>{t("backup.title")}</SettingsSectionTitle>
      {status === null ? (
        <SkeletonRow />
      ) : (
        <IconRow
          icon={<CloudIcon />}
          title={backupDriveName(provider)}
          description={current ? `${t("backup.lastBackup")} · ${summary}` : summary}
          descriptionTone={status.problem ? "warning" : "muted"}
          onClick={onOpen}
          trailing={
            <span aria-hidden="true" className="gleam-chevron flex-shrink-0 text-faint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          }
        />
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
