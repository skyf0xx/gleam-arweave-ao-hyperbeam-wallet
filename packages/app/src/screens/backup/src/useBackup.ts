import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackupStatus, RuntimePort } from "@gleam/core";

export const BACKUP_STATUS_QUERY_KEY = ["backupStatus"] as const;

export function useBackupStatus(runtime: RuntimePort, enabled = true) {
  return useQuery({
    enabled,
    queryKey: BACKUP_STATUS_QUERY_KEY,
    queryFn: () => runtime.send<void, BackupStatus>({ type: "getBackupStatus", payload: undefined }),
  });
}

/** Both writes answer with the new status; a failed one may still have changed it (a sign-in that was closed), so it reads again. */
function useStatusWrite<V>(write: (variables: V) => Promise<BackupStatus>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (status) => {
      queryClient.setQueryData(BACKUP_STATUS_QUERY_KEY, status);
    },
    onError: () => queryClient.invalidateQueries({ queryKey: BACKUP_STATUS_QUERY_KEY }),
  });
}

export function useSetUpBackup(runtime: RuntimePort) {
  return useStatusWrite((password: string) =>
    runtime.send<{ password: string }, BackupStatus>({ type: "setUpBackup", payload: { password } }),
  );
}

export function useSyncBackup(runtime: RuntimePort) {
  return useStatusWrite(() => runtime.send<void, BackupStatus>({ type: "syncBackupNow", payload: undefined }));
}

export function useLeaveBackup(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: "stopping" | "deleting") =>
      runtime.send<void, BackupStatus>({ type: kind === "stopping" ? "stopBackupSync" : "deleteBackup", payload: undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BACKUP_STATUS_QUERY_KEY }),
  });
}
